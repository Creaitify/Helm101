"""Postgres-only RLS integration tests for an explicitly disposable database."""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

SAFE_TEST_DATABASE_ENV = "HELM_TEST_DATABASE_URL"
TEST_DATABASE_URL = os.getenv(SAFE_TEST_DATABASE_ENV)
PROJECT_ROOT = Path(__file__).parents[1]

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason=(
        "RLS integration tests require an isolated disposable PostgreSQL database. "
        "Set HELM_TEST_DATABASE_URL; never use shared, staging, or production databases."
    ),
)


def _require_disposable_postgres_url(url: str) -> None:
    """Require an explicit test-named PostgreSQL database before any migration command."""

    if not url.startswith(("postgresql://", "postgresql+asyncpg://")):
        pytest.fail("HELM_TEST_DATABASE_URL must be a PostgreSQL URL; SQLite is not supported for RLS tests.")
    database_name = url.rsplit("/", maxsplit=1)[-1].split("?", maxsplit=1)[0].lower()
    if "test" not in database_name:
        pytest.fail("HELM_TEST_DATABASE_URL must name an isolated disposable database containing 'test'.")


@pytest.fixture(scope="session", autouse=True)
def migrate_disposable_database() -> Iterator[None]:
    """Bring only the declared disposable test database to the Alembic head revision."""

    assert TEST_DATABASE_URL is not None
    _require_disposable_postgres_url(TEST_DATABASE_URL)
    migration_environment = os.environ.copy()
    migration_environment["DATABASE_MIGRATION_URL"] = TEST_DATABASE_URL
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=PROJECT_ROOT,
        env=migration_environment,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail("Alembic could not migrate the declared disposable RLS test database.")
    yield


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    """Use the application role URL; tests reject a role that bypasses RLS."""

    assert TEST_DATABASE_URL is not None
    database_engine = create_async_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    try:
        yield database_engine
    finally:
        await database_engine.dispose()


async def _set_tenant_context(connection: AsyncConnection, tenant_id: UUID | None) -> None:
    await connection.execute(
        text("select set_config('app.tenant_id', :tenant_id, true)"),
        {"tenant_id": "" if tenant_id is None else str(tenant_id)},
    )


async def _insert_tenant_fixture_data(connection: AsyncConnection, tenant_id: UUID, user_id: UUID, suffix: str) -> UUID:
    """Seed a tenant's rows under its own RLS context inside a rollback-only transaction."""

    audit_id = uuid4()
    await _set_tenant_context(connection, tenant_id)
    await connection.execute(
        text("insert into tenants (id, slug, name, plan, status) values (:tenant_id, :slug, :name, 'test', 'active')"),
        {"tenant_id": str(tenant_id), "slug": f"rls-{suffix}-{tenant_id.hex[:8]}", "name": f"RLS {suffix}"},
    )
    await connection.execute(
        text(
            "insert into tenant_memberships (id, tenant_id, user_id, role, status) "
            "values (:membership_id, :tenant_id, :user_id, 'owner', 'active')"
        ),
        {"membership_id": str(uuid4()), "tenant_id": str(tenant_id), "user_id": str(user_id)},
    )
    await connection.execute(
        text(
            "insert into audit_log (id, tenant_id, actor_type, actor_id, action, target, request_id) "
            "values (:audit_id, :tenant_id, 'system', 'rls-test', 'seed', 'test', 'rls-test-request')"
        ),
        {"audit_id": str(audit_id), "tenant_id": str(tenant_id)},
    )
    return audit_id


async def _expect_database_error_in_savepoint(
    connection: AsyncConnection, statement: str, values: dict[str, str]
) -> None:
    """Assert a rejected command without poisoning the outer rollback-only transaction."""

    savepoint = await connection.begin_nested()
    try:
        with pytest.raises(DBAPIError):
            await connection.execute(text(statement), values)
    finally:
        await savepoint.rollback()


@pytest.mark.asyncio
async def test_postgres_rls_and_audit_append_only_guarantees(engine: AsyncEngine) -> None:
    """Prove cross-tenant isolation and audit immutability using real PostgreSQL only."""

    tenant_a, tenant_b, user_a, user_b = uuid4(), uuid4(), uuid4(), uuid4()
    async with engine.connect() as connection:
        bypass_result = await connection.execute(text("select rolbypassrls from pg_roles where rolname = current_user"))
        if bypass_result.scalar_one():
            pytest.fail("HELM_TEST_DATABASE_URL uses a role with BYPASSRLS; use a non-bypass application role.")

        await connection.rollback()
        transaction = await connection.begin()
        try:
            await connection.execute(
                text(
                    "insert into users (id, identity_issuer, identity_subject, email_normalized, display_name, status) "
                    "values (:user_a, 'https://test.helm', :subject_a, :email_a, 'RLS A', 'active'), "
                    "(:user_b, 'https://test.helm', :subject_b, :email_b, 'RLS B', 'active')"
                ),
                {
                    "user_a": str(user_a),
                    "subject_a": f"subject-{user_a}",
                    "email_a": f"a-{user_a.hex[:8]}@test.helm",
                    "user_b": str(user_b),
                    "subject_b": f"subject-{user_b}",
                    "email_b": f"b-{user_b.hex[:8]}@test.helm",
                },
            )
            audit_a = await _insert_tenant_fixture_data(connection, tenant_a, user_a, "a")
            audit_b = await _insert_tenant_fixture_data(connection, tenant_b, user_b, "b")

            await _set_tenant_context(connection, tenant_a)
            memberships = await connection.execute(
                text("select id from tenant_memberships where tenant_id = :tenant_id"),
                {"tenant_id": str(tenant_b)},
            )
            assert memberships.all() == []
            foreign_audit = await connection.execute(
                text("select id from audit_log where id = :audit_id"), {"audit_id": str(audit_b)}
            )
            assert foreign_audit.all() == []

            await _expect_database_error_in_savepoint(
                connection,
                "insert into audit_log (id, tenant_id, actor_type, actor_id, action, target, request_id) "
                "values (:audit_id, :tenant_id, 'system', 'rls-test', 'cross_tenant_insert', 'test', 'request')",
                {"audit_id": str(uuid4()), "tenant_id": str(tenant_b)},
            )
            await _expect_database_error_in_savepoint(
                connection,
                "update audit_log set action = 'mutated' where id = :audit_id",
                {"audit_id": str(audit_a)},
            )
            await _expect_database_error_in_savepoint(
                connection,
                "delete from audit_log where id = :audit_id",
                {"audit_id": str(audit_a)},
            )

            await _set_tenant_context(connection, None)
            missing_context_memberships = await connection.execute(text("select id from tenant_memberships"))
            missing_context_audits = await connection.execute(text("select id from audit_log"))
            assert missing_context_memberships.all() == []
            assert missing_context_audits.all() == []
        finally:
            await transaction.rollback()

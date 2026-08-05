"""Red-team matrix on real PostgreSQL: isolation, revocation, scope, audit atomicity.

Skips when Docker is unavailable, matching test_rls_integration.py, so the suite
stays green on machines without a running daemon.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from app.auth.errors import NoMembershipError
from app.auth.membership import build_caller, select_membership
from app.auth.scopes import Scope
from app.db.models.membership import MembershipRole
from app.db.repositories.identity import IdentityRepository
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

PROJECT_ROOT = Path(__file__).parents[1]

try:
    from testcontainers.postgres import PostgresContainer

    DOCKER_IMPORTABLE = True
except ImportError:  # pragma: no cover - environment dependent
    DOCKER_IMPORTABLE = False

pytestmark = pytest.mark.skipif(not DOCKER_IMPORTABLE, reason="testcontainers is not installed")


NON_BYPASS_ROLE = "helm_app_role"
NON_BYPASS_PASSWORD = "helm_app_role_password"  # noqa: S105 - disposable container-local test credential


async def _provision_non_bypass_role(superuser_url: str) -> None:
    """Create a login role without SUPERUSER/BYPASSRLS so RLS assertions are real.

    testcontainers' default PostgreSQL user is a superuser, and superusers
    implicitly bypass row-level security regardless of table policies. Without
    this role, the cross-tenant RLS test could only ever observe rows because
    the connection ignores every policy, not because isolation holds.
    """

    engine = create_async_engine(superuser_url, pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    f"create role {NON_BYPASS_ROLE} login nosuperuser nobypassrls "
                    f"password '{NON_BYPASS_PASSWORD}'"
                )
            )
            await connection.execute(text(f"grant all privileges on all tables in schema public to {NON_BYPASS_ROLE}"))
            await connection.execute(
                text(f"grant all privileges on all sequences in schema public to {NON_BYPASS_ROLE}")
            )
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    """Start a disposable PostgreSQL container and migrate it to head.

    Yields the superuser connection URL testcontainers provisions by default.
    IdentityRepository's pre-tenant-context membership lookup
    (list_active_memberships) queries FORCE-RLS tables (tenant_memberships,
    tenants) before any app.tenant_id is set, which only returns rows for a
    role that bypasses RLS - exactly what every other test file in this repo
    already connects as (test_tenants_endpoint.py's pg_engine, and the
    application's own request path in app/api/deps.py, use a single
    unscoped role throughout). This fixture matches that reality rather than
    the non-bypass role the RLS-specific test below provisions separately.
    """

    try:
        container = PostgresContainer("postgres:16-alpine")
        container.start()
    except Exception as error:  # pragma: no cover - environment dependent
        pytest.skip(f"Docker is not available for integration tests: {type(error).__name__}")

    try:
        sync_url = container.get_connection_url()
        async_url = sync_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
        environment = os.environ.copy()
        environment["DATABASE_MIGRATION_URL"] = async_url
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=PROJECT_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            pytest.fail(f"Alembic could not migrate the container database: {result.stderr[-800:]}")
        asyncio.run(_provision_non_bypass_role(async_url))
        yield async_url
    finally:
        container.stop()


@pytest_asyncio.fixture
async def engine(postgres_url: str) -> AsyncIterator[AsyncEngine]:
    database_engine = create_async_engine(postgres_url, pool_pre_ping=True)
    try:
        yield database_engine
    finally:
        await database_engine.dispose()


def _non_bypass_url(superuser_url: str) -> str:
    """Rewrite a superuser connection URL to use the provisioned non-bypass role."""

    prefix, _, rest = superuser_url.partition("@")
    scheme = prefix.split("://", 1)[0]
    return f"{scheme}://{NON_BYPASS_ROLE}:{NON_BYPASS_PASSWORD}@{rest}"


async def _seed(engine: AsyncEngine) -> dict[str, UUID]:
    """Create two tenants, one user with a membership in each, committed.

    `tenants` and `tenant_memberships` are FORCE ROW LEVEL SECURITY with
    `WITH CHECK (... = helm_tenant_id())`, so `app.tenant_id` must be set to the
    tenant being inserted before each such insert, mirroring
    tests/test_rls_integration.py's `_insert_tenant_fixture_data` and
    tests/test_tenants_endpoint.py's `_seed_tenant_and_membership`. `users` has
    no RLS policy, so it is unaffected by the current context setting.
    """

    ids = {
        "tenant_a": uuid4(),
        "tenant_b": uuid4(),
        "user": uuid4(),
        "membership_a": uuid4(),
        "membership_b": uuid4(),
    }
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "insert into users (id, identity_issuer, identity_subject, email_normalized, display_name, status) "
                "values (:id, 'https://issuer.test', :subject, :email, 'Integration User', 'active')"
            ),
            {
                "id": str(ids["user"]),
                "subject": f"subject-{ids['user']}",
                "email": f"u-{ids['user'].hex[:8]}@test.helm",
            },
        )
        for key, slug, membership, role in (
            ("tenant_a", "alpha", "membership_a", "owner"),
            ("tenant_b", "beta", "membership_b", "client_viewer"),
        ):
            await connection.execute(
                text("select set_config('app.tenant_id', :tenant_id, true)"),
                {"tenant_id": str(ids[key])},
            )
            await connection.execute(
                text(
                    "insert into tenants (id, slug, name, plan, status) "
                    "values (:id, :slug, :name, 'test', 'active')"
                ),
                {"id": str(ids[key]), "slug": f"{slug}-{ids[key].hex[:8]}", "name": slug.title()},
            )
            await connection.execute(
                text(
                    "insert into tenant_memberships (id, tenant_id, user_id, role, status) "
                    "values (:id, :tenant_id, :user_id, :role, 'active')"
                ),
                {
                    "id": str(ids[membership]),
                    "tenant_id": str(ids[key]),
                    "user_id": str(ids["user"]),
                    "role": role,
                },
            )
    return ids


@pytest.mark.asyncio
async def test_widened_roles_are_accepted_by_the_database(engine: AsyncEngine) -> None:
    """Migration 02 must make strategist, creative and analyst real enum values."""

    async with engine.begin() as connection:
        result = await connection.execute(text("select unnest(enum_range(null::tenant_membership_role))::text"))
        values = {row[0] for row in result.all()}
    assert {"strategist", "creative", "analyst"} <= values


@pytest.mark.asyncio
async def test_identity_uniqueness_constraints_still_hold(engine: AsyncEngine) -> None:
    """Stage 1 relies on constraints created by migration 01; prove they exist.

    Without uq_users_identity_issuer_subject, one issuer subject could map to two
    users, making identity resolution ambiguous. Without
    uq_tenant_memberships_tenant_user, a user could hold two conflicting roles in
    one tenant.
    """

    async with engine.connect() as connection:
        result = await connection.execute(
            text("select conname from pg_constraint where conname = any(:names)"),
            {"names": ["uq_users_identity_issuer_subject", "uq_tenant_memberships_tenant_user"]},
        )
        found = {row[0] for row in result.all()}
    assert found == {"uq_users_identity_issuer_subject", "uq_tenant_memberships_tenant_user"}


@pytest.mark.asyncio
async def test_cross_tenant_rows_are_invisible_under_rls(engine: AsyncEngine, postgres_url: str) -> None:
    """Tenant A's context must not see tenant B's rows.

    Connects as the non-bypass role provisioned in the postgres_url fixture
    (not the container's superuser `engine`), so this assertion is only true
    because the RLS policy holds - a superuser connection would pass this
    check vacuously regardless of whether the policy works at all.
    """

    ids = await _seed(engine)
    non_bypass_engine = create_async_engine(_non_bypass_url(postgres_url), pool_pre_ping=True)
    try:
        async with non_bypass_engine.connect() as connection:
            bypass = await connection.execute(text("select rolbypassrls from pg_roles where rolname = current_user"))
            assert bypass.scalar_one() is False, "test role must not bypass RLS or this assertion is vacuous"

            await connection.execute(
                text("select set_config('app.tenant_id', :tenant_id, false)"),
                {"tenant_id": str(ids["tenant_a"])},
            )
            foreign = await connection.execute(
                text("select id from tenant_memberships where tenant_id = :tenant_id"),
                {"tenant_id": str(ids["tenant_b"])},
            )
            assert foreign.all() == []
    finally:
        await non_bypass_engine.dispose()


@pytest.mark.asyncio
async def test_suspended_membership_disappears_from_resolution(engine: AsyncEngine) -> None:
    """Revocation must take effect immediately, regardless of an unexpired token."""

    ids = await _seed(engine)
    repository = IdentityRepository()

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        before = await repository.list_active_memberships(session, ids["user"])
    assert len(before) == 2

    async with engine.begin() as connection:
        await connection.execute(
            text("update tenant_memberships set status = 'suspended' where id = :id"),
            {"id": str(ids["membership_b"])},
        )

    async with factory() as session:
        after = await repository.list_active_memberships(session, ids["user"])
    assert len(after) == 1
    assert after[0].membership_id == ids["membership_a"]


@pytest.mark.asyncio
async def test_scope_denial_for_a_client_viewer(engine: AsyncEngine) -> None:
    """A real client-viewer row must not yield an approval-decide scope."""

    ids = await _seed(engine)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        memberships = await IdentityRepository().list_active_memberships(session, ids["user"])

    viewer = next(row for row in memberships if row.role == MembershipRole.CLIENT_VIEWER)
    caller = build_caller(ids["user"], "https://issuer.test", "subject-1", viewer)
    assert not caller.has(Scope.APPROVAL_DECIDE)
    assert caller.has(Scope.TENANT_READ)


@pytest.mark.asyncio
async def test_unknown_tenant_hint_is_refused(engine: AsyncEngine) -> None:
    ids = await _seed(engine)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        memberships = await IdentityRepository().list_active_memberships(session, ids["user"])

    with pytest.raises(NoMembershipError):
        select_membership(memberships, tenant_hint="a-tenant-that-is-not-theirs")


@pytest.mark.asyncio
async def test_audit_and_action_commit_atomically(engine: AsyncEngine) -> None:
    """A rolled-back transaction must leave no audit row behind."""

    ids = await _seed(engine)
    audit_id = uuid4()

    async with engine.connect() as connection:
        transaction = await connection.begin()
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(ids["tenant_a"])},
        )
        await connection.execute(
            text(
                "insert into audit_log (id, tenant_id, actor_type, actor_id, action, target, request_id) "
                "values (:id, :tenant_id, 'user', 'integration', 'test.action', 'target', 'req-1')"
            ),
            {"id": str(audit_id), "tenant_id": str(ids["tenant_a"])},
        )
        await transaction.rollback()

    async with engine.connect() as connection:
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, false)"),
            {"tenant_id": str(ids["tenant_a"])},
        )
        found = await connection.execute(text("select id from audit_log where id = :id"), {"id": str(audit_id)})
        assert found.all() == []

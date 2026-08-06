"""Unit tests for the Stage 2 database and tenant-isolation foundation."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from app.config import Settings
from app.db.models.audit import AuditActorType
from app.db.models.membership import MembershipRole, TenantMembership
from app.db.models.user import User
from app.db.repositories.audit import AuditEvent, AuditRepository
from app.db.tenant_context import TENANT_CONTEXT_SQL, TenantContext, establish_tenant_context
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession


def test_database_configuration_requires_urls_without_echoing_values(monkeypatch: pytest.MonkeyPatch) -> None:
    # Construct the absence being tested rather than inheriting it. `Settings()`
    # reads the ambient environment, so this passed only on a machine where
    # neither variable happened to be set -- and failed the moment the suite ran
    # under the integration runner, which exports DATABASE_MIGRATION_URL for
    # Alembic. The assertion was right; its precondition was accidental.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_MIGRATION_URL", raising=False)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    with pytest.raises(RuntimeError) as application_error:
        settings.require_database_url()
    with pytest.raises(RuntimeError) as migration_error:
        settings.require_migration_database_url()

    assert "DATABASE_URL" in str(application_error.value)
    assert "postgres" not in str(application_error.value).lower()
    assert "DATABASE_MIGRATION_URL" in str(migration_error.value)


def test_database_urls_are_redacted_by_settings_representation() -> None:
    settings = Settings(
        database_url=SecretStr("postgresql+asyncpg://user:super-secret@database.example/helm"),
        database_migration_url=SecretStr("postgresql+asyncpg://admin:another-secret@database.example/helm"),
    )

    assert "super-secret" not in repr(settings)
    assert "another-secret" not in repr(settings)


def test_global_user_membership_model_has_no_direct_tenant_id() -> None:
    membership_columns = set(TenantMembership.__table__.columns.keys())
    assert {"tenant_id", "user_id", "role", "scope_grants", "scope_restrictions"}.issubset(membership_columns)
    assert set(MembershipRole) == {
        MembershipRole.OWNER,
        MembershipRole.AGENCY_ADMIN,
        MembershipRole.STRATEGIST,
        MembershipRole.CREATIVE,
        MembershipRole.ANALYST,
        MembershipRole.CLIENT_VIEWER,
    }
    assert "tenant_id" not in User.__table__.columns


@pytest.mark.asyncio
async def test_tenant_context_uses_parameterized_transaction_local_sql() -> None:
    session = AsyncMock(spec=AsyncSession)
    tenant_id = uuid4()

    await establish_tenant_context(session, TenantContext(tenant_id=tenant_id))

    session.execute.assert_awaited_once_with(TENANT_CONTEXT_SQL, {"tenant_id": str(tenant_id)})


def test_tenant_context_statement_is_parameterized_and_transaction_local() -> None:
    statement = str(TENANT_CONTEXT_SQL)
    assert ":tenant_id" in statement
    assert "set_config('app.tenant_id'" in statement
    assert "true" in statement


@pytest.mark.asyncio
async def test_audit_repository_requires_tenant_context() -> None:
    repository = AuditRepository()
    session = AsyncMock(spec=AsyncSession)
    event = AuditEvent(
        actor_type=AuditActorType.SYSTEM,
        actor_id="bootstrap",
        action="test",
        target="test",
        request_id="request-1",
    )

    with pytest.raises(ValueError, match="tenant context"):
        await repository.append(session, None, event)


@pytest.mark.asyncio
async def test_audit_repository_rejects_nested_metadata() -> None:
    repository = AuditRepository()
    session = AsyncMock(spec=AsyncSession)
    event = AuditEvent(
        actor_type=AuditActorType.SYSTEM,
        actor_id="bootstrap",
        action="test",
        target="test",
        request_id="request-1",
        metadata={"reason_code": {"must_not": "be_stored"}},
    )

    with pytest.raises(ValueError, match="scalar codes"):
        await repository.append(session, TenantContext(tenant_id=uuid4()), event)


@pytest.mark.asyncio
async def test_audit_repository_rejects_an_actor_id_longer_than_the_column() -> None:
    """A repository that silently accepted an oversized actor_id would be a trap for

    the next caller: the database would reject it with a raw
    StringDataRightTruncation deep inside a transaction instead of a clear
    ValueError at the call site. actor_id is composed as f"{issuer}#{subject}"
    from two String(500) identity columns, so 1010 is the widest legitimate
    value; anything past it must be rejected before it ever reaches SQL.
    """

    repository = AuditRepository()
    session = AsyncMock(spec=AsyncSession)
    event = AuditEvent(
        actor_type=AuditActorType.USER,
        actor_id="x" * 1011,
        action="test",
        target="test",
        request_id="request-1",
    )

    with pytest.raises(ValueError, match="actor_id"):
        await repository.append(session, TenantContext(tenant_id=uuid4()), event)


def test_initial_migration_contains_rls_and_append_only_controls() -> None:
    migration = Path(__file__).parents[1] / "alembic" / "versions" / "20260727_01_foundation.py"
    contents = migration.read_text(encoding="utf-8")

    assert "helm_tenant_id" in contents
    assert "nullif(current_setting('app.tenant_id', true), '')::uuid" in contents
    assert "enable row level security" in contents
    assert "force row level security" in contents
    assert "tenants_tenant_isolation" in contents
    assert "tenant_memberships_tenant_isolation" in contents
    assert "audit_log_tenant_isolation" in contents
    assert "prevent_audit_log_mutation" in contents
    assert "before update or delete" in contents
    assert "set_foundation_updated_at" in contents

"""Provisioning is the only way a real person enters HELM; it must be exact."""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.cli.provision import provision_member
from app.db.models.audit import AuditLog
from app.db.models.membership import MembershipRole, MembershipStatus, TenantMembership
from app.db.models.tenant import Tenant
from app.db.models.user import User
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from tests.conftest import DOCKER_IMPORTABLE, NON_BYPASS_PASSWORD, NON_BYPASS_ROLE

# `pytest.mark.integration` alone is inert: it is not registered in
# pyproject.toml's [tool.pytest.ini_options] (no `markers` entry), so it
# selects and skips nothing - it only emits PytestUnknownMarkWarning. Without
# this skipif, running the suite with testcontainers uninstalled would hit
# `PostgresContainer(...)` in conftest.py's `postgres_url` as an undefined
# name; the resulting NameError is swallowed by that fixture's broad
# `except Exception` and resurfaces as a misleadingly generic "Docker is not
# available" skip reason instead of a clean, honest collection-time skip.
# Matches tests/test_identity_integration.py's guard exactly.
pytestmark = pytest.mark.skipif(not DOCKER_IMPORTABLE, reason="testcontainers is not installed")


@pytest.mark.asyncio
async def test_creates_user_and_membership(
    provisioned_tenant: Tenant, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    async with session_factory() as session:
        result = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|abc123",
            email="person@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.OWNER,
        )
        assert result.created_user is True

    async with session_factory() as session:
        user = (await session.execute(select(User).where(User.identity_subject == "auth0|abc123"))).scalar_one()
        assert user.identity_issuer == "https://helm.eu.auth0.com/"
        assert user.email_normalized == "person@agency.test"


@pytest.mark.asyncio
async def test_is_idempotent_for_the_same_identity(
    provisioned_tenant: Tenant, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """Re-running must not create a second user or a duplicate membership."""

    args = dict(
        issuer="https://helm.eu.auth0.com/",
        subject="auth0|abc123",
        email="person@agency.test",
        tenant_slug=provisioned_tenant.slug,
        role=MembershipRole.OWNER,
    )
    async with session_factory() as session:
        first = await provision_member(session, **args)
    async with session_factory() as session:
        second = await provision_member(session, **args)

    assert second.created_user is False
    assert second.user_id == first.user_id
    assert second.membership_id == first.membership_id


@pytest.mark.asyncio
async def test_same_email_different_subject_is_a_different_user(
    provisioned_tenant: Tenant, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """Email is not an identity key: two subjects sharing an address are two users."""

    async with session_factory() as session:
        first = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|first",
            email="shared@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.OWNER,
        )
    async with session_factory() as session:
        second = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|second",
            email="shared@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.ANALYST,
        )

    assert first.user_id != second.user_id


@pytest.mark.asyncio
async def test_unknown_tenant_is_refused(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        with pytest.raises(LookupError):
            await provision_member(
                session,
                issuer="https://helm.eu.auth0.com/",
                subject="auth0|abc123",
                email="person@agency.test",
                tenant_slug="no-such-tenant",
                role=MembershipRole.OWNER,
            )


@pytest.mark.asyncio
async def test_writes_an_audit_event(
    provisioned_tenant: Tenant, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    async with session_factory() as session:
        await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|abc123",
            email="person@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.OWNER,
        )

    # Scoped to this test's own tenant: the container is module-scoped, so an
    # unscoped query would also pick up audit rows other tests in this module
    # wrote for the same action, making this assertion pass or fail based on
    # test order rather than this test's own behaviour.
    async with session_factory() as session:
        events = (
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.action == "membership.provisioned",
                        AuditLog.tenant_id == provisioned_tenant.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        # AuditRepository rejects metadata keys outside its allow-list, so this
        # asserts the event was built within that contract rather than around it.
        assert set(events[0].metadata_json) <= {"source", "outcome"}
        # Role information must live in `target`, never in `metadata` (the
        # allow-list has no `role` key and would raise ValueError on one).
        assert "role" not in events[0].metadata_json
        assert "owner" in events[0].target


@pytest.mark.asyncio
async def test_membership_is_active_on_creation(
    provisioned_tenant: Tenant, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    async with session_factory() as session:
        result = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|abc123",
            email="person@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.STRATEGIST,
        )

    async with session_factory() as session:
        membership = await session.get(TenantMembership, result.membership_id)
        assert membership is not None
        assert membership.status == MembershipStatus.ACTIVE
        assert membership.role == MembershipRole.STRATEGIST


@pytest.mark.asyncio
async def test_membership_insert_survives_a_non_bypass_rls_role(
    provisioned_tenant: Tenant, engine: AsyncEngine
) -> None:
    """Provisioning must work under the least-privileged application role, not just a superuser.

    tenant_memberships and audit_log are FORCE ROW LEVEL SECURITY with
    `WITH CHECK (tenant_id = helm_tenant_id())`. The container's default
    connection is a superuser, which implicitly bypasses RLS regardless of
    whether the tenant context was ever established - so a version of
    provision_member that forgot to call establish_tenant_context could still
    pass every other test in this file while failing in production under the
    real non-bypass application role. This test connects through the
    provisioned non-bypass role (see tests/conftest.py) to make sure that gap
    cannot exist here.

    Asserts `rolbypassrls`/`rolsuper` are both false before trusting the
    connection at all, matching the same guard
    `test_identity_integration.py::test_cross_tenant_rows_are_invisible_under_rls`
    and `test_rls_integration.py` use - without it, this test would stay green
    even if `NON_BYPASS_ROLE` were later granted BYPASSRLS, the URL rewrite
    silently fell back to the superuser, or role provisioning changed, and it
    would then prove nothing about the defect it exists to catch.
    """

    superuser_url = str(engine.url)
    prefix, _, rest = superuser_url.partition("@")
    scheme = prefix.split("://", 1)[0]
    non_bypass_url = f"{scheme}://{NON_BYPASS_ROLE}:{NON_BYPASS_PASSWORD}@{rest}"

    non_bypass_engine = create_async_engine(non_bypass_url, pool_pre_ping=True)
    try:
        async with non_bypass_engine.connect() as connection:
            row = await connection.execute(
                text("select rolbypassrls, rolsuper from pg_roles where rolname = current_user")
            )
            assert row.one() == (False, False), "test role must not bypass RLS or this assertion is vacuous"

        factory = async_sessionmaker(non_bypass_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            result = await provision_member(
                session,
                issuer="https://helm.eu.auth0.com/",
                subject="auth0|non-bypass",
                email="person@agency.test",
                tenant_slug=provisioned_tenant.slug,
                role=MembershipRole.OWNER,
            )
        assert result.created_user is True
    finally:
        await non_bypass_engine.dispose()


@pytest.mark.asyncio
async def test_tenant_lookup_ignores_a_shadowing_temp_table(engine: AsyncEngine) -> None:
    """Prove `helm_lookup_active_tenant_by_slug` cannot be tricked by a `pg_temp` shadow table.

    `pg_temp` is implicitly searched FIRST whenever it is not listed in
    `search_path`, and `PUBLIC` holds `TEMP` on the database by default. A
    function declared `set search_path = public` alone (without `pg_temp`
    listed explicitly and last) is exploitable: any role that can execute it
    can `create temp table tenants (...)` in its own session and the
    SECURITY DEFINER function will join against that attacker-controlled
    table instead of the real `public.tenants`, resolving an attacker-chosen
    slug to a *real* victim tenant's UUID. That is worse than the analogous
    membership-lookup escalation
    (`test_identity_integration.py::test_membership_lookup_function_ignores_a_
    shadowing_temp_table`, which this test mirrors): here it would let a
    caller establish `app.tenant_id` to a tenant they resolved through a
    fabricated slug, defeating tenant isolation for the rest of the
    transaction, not merely leaking membership rows.

    Migration `20260805_05_tenant_lookup_by_slug_function.py` pins
    `set search_path = public, pg_temp`, inheriting the fix
    `20260805_04_membership_lookup_function.py` proved necessary. This test
    exists so a future edit that drops `, pg_temp` from the new function is
    caught here too, not just for its sibling - the same regression has
    already happened once in this codebase (see that migration's docstring).

    Connects as the non-bypass role, in a single session: creates a temp
    `tenants` table mapping a fabricated slug to a real victim tenant's id,
    then calls the function with that fabricated slug. The fixed function
    must return zero rows: `public.tenants` (searched via the pinned,
    non-shadowable path) has no row with that slug, so the filter produces
    nothing, regardless of what the caller's own `pg_temp.tenants` claims.
    """

    superuser_url = str(engine.url)
    prefix, _, rest = superuser_url.partition("@")
    scheme = prefix.split("://", 1)[0]
    non_bypass_url = f"{scheme}://{NON_BYPASS_ROLE}:{NON_BYPASS_PASSWORD}@{rest}"

    victim_tenant_id = uuid4()
    async with engine.begin() as connection:
        await connection.execute(
            text("insert into tenants (id, slug, name, plan, status) values (:id, :slug, 'Victim', 'test', 'active')"),
            {"id": str(victim_tenant_id), "slug": f"victim-{victim_tenant_id.hex[:8]}"},
        )

    fabricated_slug = "attacker-controlled-slug"
    non_bypass_engine = create_async_engine(non_bypass_url, pool_pre_ping=True)
    try:
        async with non_bypass_engine.begin() as connection:
            await connection.execute(
                text("create temp table tenants (id uuid, slug text, name text, status tenant_status)")
            )
            await connection.execute(
                text("insert into tenants (id, slug, name, status) values (:id, :slug, 'Attacker', 'active')"),
                {"id": str(victim_tenant_id), "slug": fabricated_slug},
            )
            escalated = await connection.execute(
                text("select id from helm_lookup_active_tenant_by_slug(:slug)"),
                {"slug": fabricated_slug},
            )
            escalated_rows = escalated.all()

        assert escalated_rows == [], (
            "helm_lookup_active_tenant_by_slug returned a row for a slug that exists only in a "
            "session-local temp table shadowing 'tenants' - the pg_temp search-path fix regressed"
        )
    finally:
        await non_bypass_engine.dispose()

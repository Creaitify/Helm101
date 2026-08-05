"""Provisioning is the only way a real person enters HELM; it must be exact."""

from __future__ import annotations

import pytest
from app.cli.provision import provision_member
from app.db.models.audit import AuditLog
from app.db.models.membership import MembershipRole, MembershipStatus, TenantMembership
from app.db.models.tenant import Tenant
from app.db.models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from tests.conftest import NON_BYPASS_PASSWORD, NON_BYPASS_ROLE

pytestmark = pytest.mark.integration


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
    """

    superuser_url = str(engine.url)
    prefix, _, rest = superuser_url.partition("@")
    scheme = prefix.split("://", 1)[0]
    non_bypass_url = f"{scheme}://{NON_BYPASS_ROLE}:{NON_BYPASS_PASSWORD}@{rest}"

    non_bypass_engine = create_async_engine(non_bypass_url, pool_pre_ping=True)
    try:
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

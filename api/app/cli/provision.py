"""Deliberately provision a user and tenant membership, with an audit trail.

Stage 1 refuses to auto-create users: a valid token for an unknown subject
raises `NoMembershipError` rather than creating an account, because implicit
provisioning from a token is how tenants acquire members nobody decided to
add. This module is the deliberate, audited alternative - the only way a real
person enters HELM. It is not an invitation lifecycle: there is no pending
state, no expiry, no email delivery. It creates (or reuses) a user and grants
an active membership, in one transaction, with an audit record.
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models.audit import AuditActorType
from app.db.models.membership import MembershipRole, MembershipStatus, TenantMembership
from app.db.models.user import User, UserStatus
from app.db.repositories.audit import AuditEvent, AuditRepository
from app.db.repositories.identity import IdentityRepository
from app.db.session import create_database_engine, create_session_factory
from app.db.tenant_context import TenantContext, establish_tenant_context


@dataclass(frozen=True, slots=True)
class ProvisionResult:
    """Outcome of a provisioning run."""

    user_id: UUID
    membership_id: UUID
    created_user: bool


async def provision_member(
    session: AsyncSession,
    *,
    issuer: str,
    subject: str,
    email: str,
    tenant_slug: str,
    role: MembershipRole,
    display_name: str | None = None,
) -> ProvisionResult:
    """Create or reuse a user, then grant an active membership in one transaction.

    Idempotent on (issuer, subject) for the user and on (tenant, user) for the
    membership, so re-running is safe. Email is stored for correlation only and
    is never an identity key: two subjects sharing an address are two users.

    `tenants`, `tenant_memberships`, and `audit_log` are all FORCE ROW LEVEL
    SECURITY with `WITH CHECK (tenant_id = helm_tenant_id())` (`tenants` on its
    own `id`), and `helm_tenant_id()` is NULL until a tenant context has been
    established - which is necessarily after the tenant is resolved, since
    resolving the tenant is the whole point of the `tenant_slug` lookup. So the
    slug lookup itself cannot be a plain RLS-scoped query; it goes through
    `IdentityRepository.find_active_tenant_by_slug`, a narrow SECURITY DEFINER
    keyhole, exactly mirroring how membership resolution solves the same
    chicken-and-egg problem. Once the tenant is known, `app.tenant_id` is
    established for the rest of the transaction so the membership and audit
    inserts satisfy their own RLS `WITH CHECK` policies - otherwise both writes
    would raise under any connection that is not a superuser (i.e. the real,
    least-privileged application role), even though they would pass silently
    in a test that only ever connects as a superuser.

    Raises `LookupError` if no active tenant has the given slug.
    """

    tenant = await IdentityRepository().find_active_tenant_by_slug(session, tenant_slug)
    if tenant is None:
        raise LookupError(f"No active tenant with slug {tenant_slug!r}")

    context = TenantContext(tenant_id=tenant.id)
    await establish_tenant_context(session, context)

    user = (
        await session.execute(
            select(User).where(User.identity_issuer == issuer, User.identity_subject == subject)
        )
    ).scalar_one_or_none()
    created_user = user is None
    if user is None:
        user = User(
            identity_issuer=issuer,
            identity_subject=subject,
            # The column is `email_normalized`, not `email`: stored lowercased
            # for correlation only. Email is never an identity key.
            email_normalized=email.strip().lower(),
            display_name=display_name or email.split("@")[0],
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.flush()

    membership = (
        await session.execute(
            select(TenantMembership).where(
                TenantMembership.tenant_id == tenant.id,
                TenantMembership.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        membership = TenantMembership(
            tenant_id=tenant.id,
            user_id=user.id,
            role=role,
            status=MembershipStatus.ACTIVE,
        )
        session.add(membership)
        await session.flush()

    await AuditRepository().append(
        session,
        context,
        AuditEvent(
            actor_type=AuditActorType.SYSTEM,
            actor_id=f"{issuer}#{subject}",
            action="membership.provisioned",
            # AuditRepository allow-lists metadata keys (ALLOWED_AUDIT_METADATA_KEYS
            # has no `role` entry and raises ValueError on one), so role
            # information belongs in `target`, never in `metadata`.
            target=f"tenant_membership:{membership.id}:role={role.value}",
            request_id=f"provision-{membership.id}",
            metadata={"source": "cli", "outcome": "created" if created_user else "reused"},
        ),
    )
    await session.commit()
    return ProvisionResult(user_id=user.id, membership_id=membership.id, created_user=created_user)


def main() -> None:
    """Entry point: python -m app.cli.provision --issuer ... --subject ..."""

    parser = argparse.ArgumentParser(description="Provision a HELM user and membership")
    parser.add_argument("--issuer", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--tenant", required=True, help="Tenant slug")
    parser.add_argument("--role", required=True, choices=[role.value for role in MembershipRole])
    parser.add_argument("--display-name", default=None, help="Defaults to the email local part")
    args = parser.parse_args()

    async def run() -> None:
        settings = Settings()
        engine = create_database_engine(settings)
        factory = create_session_factory(engine)
        try:
            async with factory() as session:
                result = await provision_member(
                    session,
                    issuer=args.issuer,
                    subject=args.subject,
                    email=args.email,
                    tenant_slug=args.tenant,
                    role=MembershipRole(args.role),
                    display_name=args.display_name,
                )
            print(f"user={result.user_id} membership={result.membership_id} created={result.created_user}")
        finally:
            await engine.dispose()

    asyncio.run(run())


if __name__ == "__main__":
    main()

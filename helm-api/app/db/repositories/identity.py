"""Identity and membership queries used before and after tenant context exists."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.membership import MembershipRole, MembershipStatus, TenantMembership
from app.db.models.tenant import Tenant, TenantStatus
from app.db.models.user import User, UserStatus


@dataclass(frozen=True, slots=True)
class MembershipRow:
    """One active membership joined to its tenant, flattened for authorization."""

    membership_id: UUID
    tenant_id: UUID
    tenant_slug: str
    tenant_name: str
    role: MembershipRole
    scope_grants: list[str]
    scope_restrictions: list[str]


class IdentityRepository:
    """Reads identity and membership rows.

    Membership lookup must run before any tenant context exists, so these
    queries are issued outside RLS scope. They are deliberately narrow: an exact
    issuer/subject match and that user's own active memberships only.
    """

    async def find_user(self, session: AsyncSession, issuer: str, subject: str) -> User | None:
        """Find an active global user by immutable issuer and subject."""

        statement = select(User).where(
            User.identity_issuer == issuer,
            User.identity_subject == subject,
            User.status == UserStatus.ACTIVE,
        )
        result = await session.execute(statement)
        return result.scalar_one_or_none()

    async def list_active_memberships(self, session: AsyncSession, user_id: UUID) -> list[MembershipRow]:
        """List active memberships in active tenants, deterministically ordered."""

        statement = (
            select(
                TenantMembership.id,
                TenantMembership.tenant_id,
                Tenant.slug,
                Tenant.name,
                TenantMembership.role,
                TenantMembership.scope_grants,
                TenantMembership.scope_restrictions,
            )
            .join(Tenant, Tenant.id == TenantMembership.tenant_id)
            .where(
                TenantMembership.user_id == user_id,
                TenantMembership.status == MembershipStatus.ACTIVE,
                Tenant.status == TenantStatus.ACTIVE,
            )
            .order_by(Tenant.created_at.asc(), TenantMembership.id.asc())
        )
        result = await session.execute(statement)
        return [
            MembershipRow(
                membership_id=row[0],
                tenant_id=row[1],
                tenant_slug=row[2],
                tenant_name=row[3],
                role=row[4],
                scope_grants=list(row[5] or []),
                scope_restrictions=list(row[6] or []),
            )
            for row in result.all()
        ]

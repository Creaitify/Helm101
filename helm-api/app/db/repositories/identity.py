"""Identity and membership queries used before and after tenant context exists."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.membership import MembershipRole
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

    `users` carries no RLS policy (the foundation migration's RLS loop covers
    only `tenants`, `tenant_memberships`, and `audit_log`), so `find_user` is a
    plain ORM query. `tenant_memberships` and `tenants` are both `FORCE ROW
    LEVEL SECURITY` with `tenant_id = helm_tenant_id()`, which is NULL -- and
    therefore admits no rows -- until a tenant has been selected. Since
    selecting the tenant is the point of `list_active_memberships`, it cannot
    run as an ordinary tenant-scoped query; it instead calls
    `helm_lookup_active_memberships`, a narrow `SECURITY DEFINER` function
    (see `alembic/versions/20260805_04_membership_lookup_function.py`) keyed
    on `(identity_issuer, identity_subject)` -- never a bare user_id and never
    email -- that returns only the passed identity's own active memberships.
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

    async def list_active_memberships(self, session: AsyncSession, issuer: str, subject: str) -> list[MembershipRow]:
        """List active memberships in active tenants, deterministically ordered.

        Keyed on `(issuer, subject)` rather than `user_id` because the caller
        (`app/api/deps.py::current_caller`, via `resolve_identity`) already
        holds the verified issuer/subject pair at this point and this is
        exactly what the underlying `SECURITY DEFINER` function is
        parameterised on -- passing a bare user_id would require either
        looking the identity back up first, or widening the function to trust
        a caller-supplied UUID, which is a larger keyhole for no benefit.
        """

        statement = text(
            "select membership_id, tenant_id, tenant_slug, tenant_name, role, "
            "scope_grants, scope_restrictions "
            "from helm_lookup_active_memberships(:issuer, :subject)"
        )
        result = await session.execute(statement, {"issuer": issuer, "subject": subject})
        return [
            MembershipRow(
                membership_id=row.membership_id,
                tenant_id=row.tenant_id,
                tenant_slug=row.tenant_slug,
                tenant_name=row.tenant_name,
                role=MembershipRole(row.role),
                scope_grants=list(row.scope_grants or []),
                scope_restrictions=list(row.scope_restrictions or []),
            )
            for row in result.all()
        ]

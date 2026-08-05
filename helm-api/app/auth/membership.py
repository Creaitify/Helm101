"""Choose which tenant membership a request acts under."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from app.auth.errors import NoMembershipError, TenantContextRequiredError
from app.auth.scopes import Scope, effective_scopes
from app.db.models.membership import MembershipRole
from app.db.repositories.identity import MembershipRow


@dataclass(frozen=True, slots=True)
class AuthenticatedCaller:
    """Everything an endpoint may trust about the caller, resolved server-side."""

    user_id: UUID
    issuer: str
    subject: str
    membership_id: UUID
    tenant_id: UUID
    tenant_slug: str
    role: MembershipRole
    scopes: frozenset[Scope]

    def has(self, scope: Scope) -> bool:
        """Report whether this caller holds a scope."""

        return scope in self.scopes


def select_membership(memberships: Sequence[MembershipRow], tenant_hint: str | None) -> MembershipRow:
    """Pick the membership a request acts under.

    The hint is untrusted input matched against the caller's own memberships by
    slug or tenant id. An unmatched hint and an empty membership list raise the
    same error, so the response cannot reveal whether a tenant exists.
    """

    if not memberships:
        raise NoMembershipError

    if tenant_hint is None:
        if len(memberships) == 1:
            return memberships[0]
        raise TenantContextRequiredError

    hint = tenant_hint.strip()
    for membership in memberships:
        if hint == membership.tenant_slug or hint == str(membership.tenant_id):
            return membership
    raise NoMembershipError


def build_caller(identity_user_id: UUID, issuer: str, subject: str, membership: MembershipRow) -> AuthenticatedCaller:
    """Assemble the caller, computing effective scopes server-side."""

    return AuthenticatedCaller(
        user_id=identity_user_id,
        issuer=issuer,
        subject=subject,
        membership_id=membership.membership_id,
        tenant_id=membership.tenant_id,
        tenant_slug=membership.tenant_slug,
        role=membership.role,
        scopes=effective_scopes(membership.role, membership.scope_grants, membership.scope_restrictions),
    )

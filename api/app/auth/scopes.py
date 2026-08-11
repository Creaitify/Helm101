"""Pure role-to-scope arithmetic with no I/O, so it can be tested exhaustively."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from enum import StrEnum

from app.db.models.membership import MembershipRole


class Scope(StrEnum):
    """Every permission the Stage 1 API can require."""

    TENANT_READ = "tenant:read"
    CAMPAIGN_READ = "campaign:read"
    CAMPAIGN_WRITE = "campaign:write"
    APPROVAL_READ = "approval:read"
    APPROVAL_DECIDE = "approval:decide"
    CREATIVE_READ = "creative:read"
    CREATIVE_WRITE = "creative:write"
    INTEGRATION_READ = "integration:read"
    INTEGRATION_WRITE = "integration:write"
    MEMBER_READ = "member:read"
    MEMBER_WRITE = "member:write"
    AUDIT_READ = "audit:read"


_READ_ONLY = frozenset(
    {
        Scope.TENANT_READ,
        Scope.CAMPAIGN_READ,
        Scope.APPROVAL_READ,
        Scope.CREATIVE_READ,
        Scope.INTEGRATION_READ,
        Scope.MEMBER_READ,
    }
)

ROLE_DEFAULT_SCOPES: Mapping[MembershipRole, frozenset[Scope]] = {
    MembershipRole.OWNER: frozenset(Scope),
    MembershipRole.AGENCY_ADMIN: frozenset(Scope) - {Scope.MEMBER_WRITE},
    MembershipRole.STRATEGIST: frozenset(
        {
            Scope.TENANT_READ,
            Scope.CAMPAIGN_READ,
            Scope.CAMPAIGN_WRITE,
            Scope.APPROVAL_READ,
            Scope.APPROVAL_DECIDE,
            Scope.CREATIVE_READ,
            Scope.INTEGRATION_READ,
            Scope.MEMBER_READ,
        }
    ),
    MembershipRole.CREATIVE: frozenset(
        {
            Scope.TENANT_READ,
            Scope.CAMPAIGN_READ,
            Scope.CREATIVE_READ,
            Scope.CREATIVE_WRITE,
            Scope.APPROVAL_READ,
            Scope.MEMBER_READ,
        }
    ),
    MembershipRole.ANALYST: frozenset(
        {
            Scope.TENANT_READ,
            Scope.CAMPAIGN_READ,
            Scope.APPROVAL_READ,
            Scope.CREATIVE_READ,
            Scope.INTEGRATION_READ,
            Scope.MEMBER_READ,
            Scope.AUDIT_READ,
        }
    ),
    MembershipRole.CLIENT_VIEWER: _READ_ONLY,
}

# The maximum a membership grant may reach for each role. Grants may fill a role
# up to its ceiling but never past it, so a stray grant row cannot silently
# promote a client viewer into an approver.
ROLE_CEILINGS: Mapping[MembershipRole, frozenset[Scope]] = {
    MembershipRole.OWNER: frozenset(Scope),
    # AGENCY_ADMIN sits directly below OWNER in the role hierarchy, so an audited grant
    # can extend it to MEMBER_WRITE (unlike STRATEGIST, whose ceiling excludes it).
    MembershipRole.AGENCY_ADMIN: frozenset(Scope),
    MembershipRole.STRATEGIST: frozenset(Scope) - {Scope.MEMBER_WRITE},
    MembershipRole.CREATIVE: ROLE_DEFAULT_SCOPES[MembershipRole.CREATIVE] | {Scope.CAMPAIGN_WRITE},
    MembershipRole.ANALYST: ROLE_DEFAULT_SCOPES[MembershipRole.ANALYST] | {Scope.CAMPAIGN_WRITE},
    MembershipRole.CLIENT_VIEWER: _READ_ONLY,
}


def _parse(values: Iterable[str]) -> frozenset[Scope]:
    """Convert stored scope strings to Scope members, dropping unknown values.

    Unknown strings are ignored rather than raising: a scope removed in a later
    release must not make every existing membership row unauthenticatable.
    """

    known = {scope.value: scope for scope in Scope}
    return frozenset(known[value] for value in values if value in known)


def effective_scopes(
    role: MembershipRole,
    grants: Iterable[str],
    restrictions: Iterable[str],
) -> frozenset[Scope]:
    """Compute the scopes a membership actually holds.

    Defaults come from the role. Grants may add, but only up to the role's
    ceiling. Restrictions always subtract and always win over a conflicting
    grant, so revoking a permission cannot be undone by adding a grant row.
    """

    defaults = ROLE_DEFAULT_SCOPES[role]
    ceiling = ROLE_CEILINGS[role]
    granted = (defaults | _parse(grants)) & ceiling
    return granted - _parse(restrictions)

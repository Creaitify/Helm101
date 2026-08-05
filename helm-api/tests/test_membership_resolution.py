"""Membership selection decides which tenant a request acts in; it must be explicit."""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.auth.errors import NoMembershipError, TenantContextRequiredError
from app.auth.membership import select_membership
from app.db.models.membership import MembershipRole
from app.db.repositories.identity import MembershipRow


def _row(slug: str, role: MembershipRole = MembershipRole.OWNER) -> MembershipRow:
    return MembershipRow(
        membership_id=uuid4(),
        tenant_id=uuid4(),
        tenant_slug=slug,
        tenant_name=slug.title(),
        role=role,
        scope_grants=[],
        scope_restrictions=[],
    )


def test_single_membership_needs_no_hint() -> None:
    row = _row("finnovate")
    assert select_membership([row], tenant_hint=None) is row


def test_multiple_memberships_require_an_explicit_selection() -> None:
    """Picking implicitly would make the acting tenant plan-dependent."""

    with pytest.raises(TenantContextRequiredError):
        select_membership([_row("alpha"), _row("beta")], tenant_hint=None)


def test_hint_selects_the_matching_membership() -> None:
    alpha, beta = _row("alpha"), _row("beta")
    assert select_membership([alpha, beta], tenant_hint="beta") is beta


def test_hint_matches_on_tenant_id_too() -> None:
    alpha = _row("alpha")
    assert select_membership([alpha], tenant_hint=str(alpha.tenant_id)) is alpha


def test_unknown_hint_is_refused_as_no_membership() -> None:
    with pytest.raises(NoMembershipError):
        select_membership([_row("alpha")], tenant_hint="not-mine")


def test_no_memberships_at_all_is_refused() -> None:
    with pytest.raises(NoMembershipError):
        select_membership([], tenant_hint=None)


def test_no_memberships_with_a_hint_is_the_same_refusal() -> None:
    """A caller must not learn whether the tenant exists by varying the hint."""

    with pytest.raises(NoMembershipError):
        select_membership([], tenant_hint="some-tenant")

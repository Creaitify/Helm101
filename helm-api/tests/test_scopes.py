"""Scope arithmetic is pure, so every role and modifier combination is tested."""

from __future__ import annotations

import pytest
from app.auth.scopes import ROLE_CEILINGS, ROLE_DEFAULT_SCOPES, Scope, effective_scopes
from app.db.models.membership import MembershipRole


def test_every_role_has_defined_defaults() -> None:
    """A role with no entry would silently grant nothing; fail loudly instead."""

    for role in MembershipRole:
        assert role in ROLE_DEFAULT_SCOPES, f"{role} has no default scopes"


def test_owner_holds_every_scope() -> None:
    assert ROLE_DEFAULT_SCOPES[MembershipRole.OWNER] == frozenset(Scope)


def test_client_viewer_is_read_only() -> None:
    for scope in ROLE_DEFAULT_SCOPES[MembershipRole.CLIENT_VIEWER]:
        assert scope.value.endswith(":read"), f"{scope} is not read-only"


def test_client_viewer_cannot_decide_approvals() -> None:
    assert Scope.APPROVAL_DECIDE not in ROLE_DEFAULT_SCOPES[MembershipRole.CLIENT_VIEWER]


def test_restrictions_subtract_from_defaults() -> None:
    result = effective_scopes(MembershipRole.OWNER, grants=[], restrictions=[Scope.APPROVAL_DECIDE.value])
    assert Scope.APPROVAL_DECIDE not in result
    assert Scope.CAMPAIGN_READ in result


def test_grants_add_within_the_role_ceiling() -> None:
    result = effective_scopes(MembershipRole.ANALYST, grants=[Scope.CAMPAIGN_WRITE.value], restrictions=[])
    assert Scope.CAMPAIGN_WRITE in result


def test_grant_cannot_exceed_the_role_ceiling() -> None:
    """A client viewer must not become an approver through a stray grant."""

    result = effective_scopes(MembershipRole.CLIENT_VIEWER, grants=[Scope.APPROVAL_DECIDE.value], restrictions=[])
    assert Scope.APPROVAL_DECIDE not in result


def test_restriction_beats_a_conflicting_grant() -> None:
    result = effective_scopes(
        MembershipRole.OWNER,
        grants=[Scope.CAMPAIGN_WRITE.value],
        restrictions=[Scope.CAMPAIGN_WRITE.value],
    )
    assert Scope.CAMPAIGN_WRITE not in result


def test_unknown_scope_strings_are_ignored_not_crashed() -> None:
    result = effective_scopes(MembershipRole.ANALYST, grants=["not:a:scope"], restrictions=["also:bogus"])
    assert result == ROLE_DEFAULT_SCOPES[MembershipRole.ANALYST]


@pytest.mark.parametrize("role", list(MembershipRole))
def test_result_never_exceeds_the_ceiling_for_any_role(role: MembershipRole) -> None:
    result = effective_scopes(role, grants=[scope.value for scope in Scope], restrictions=[])
    assert result <= ROLE_CEILINGS[role]

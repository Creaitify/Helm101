"""Header parsing and scope gating, isolated from the database."""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.api.deps import bearer_token, require_scope
from app.auth.errors import InsufficientScopeError, InvalidTokenError
from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import Scope
from app.db.models.membership import MembershipRole
from fastapi import Request


def _request(headers: dict[str, str]) -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in headers.items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw})


def test_extracts_a_bearer_token() -> None:
    assert bearer_token(_request({"authorization": "Bearer abc.def.ghi"})) == "abc.def.ghi"


def test_bearer_scheme_is_case_insensitive() -> None:
    assert bearer_token(_request({"authorization": "bearer abc.def.ghi"})) == "abc.def.ghi"


@pytest.mark.parametrize(
    "header",
    ["", "Bearer", "Bearer ", "Basic abc", "abc.def.ghi", "Bearer  "],
)
def test_rejects_malformed_authorization_headers(header: str) -> None:
    with pytest.raises(InvalidTokenError):
        bearer_token(_request({"authorization": header} if header else {}))


def _caller(*scopes: Scope) -> AuthenticatedCaller:
    return AuthenticatedCaller(
        user_id=uuid4(),
        issuer="https://issuer.test",
        subject="subject-1",
        membership_id=uuid4(),
        tenant_id=uuid4(),
        tenant_slug="finnovate",
        role=MembershipRole.ANALYST,
        scopes=frozenset(scopes),
    )


@pytest.mark.asyncio
async def test_require_scope_allows_a_caller_holding_it() -> None:
    guard = require_scope(Scope.TENANT_READ)
    caller = _caller(Scope.TENANT_READ)
    assert await guard(caller) is caller


@pytest.mark.asyncio
async def test_require_scope_refuses_a_caller_lacking_it() -> None:
    guard = require_scope(Scope.APPROVAL_DECIDE)
    with pytest.raises(InsufficientScopeError):
        await guard(_caller(Scope.TENANT_READ))

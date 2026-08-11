"""Auth failures must map to safe, non-enumerable problem responses."""

from __future__ import annotations

import pytest
from app.auth.errors import (
    AuthError,
    InsufficientScopeError,
    InvalidTokenError,
    NoMembershipError,
    TenantContextRequiredError,
    auth_exception_handler,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(error: AuthError) -> TestClient:
    app = FastAPI()
    app.add_exception_handler(AuthError, auth_exception_handler)

    @app.get("/boom")
    async def boom() -> None:
        raise error

    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (InvalidTokenError(), 401, "invalid_token"),
        (InsufficientScopeError(), 403, "insufficient_scope"),
        (NoMembershipError(), 403, "no_membership"),
        (TenantContextRequiredError(), 400, "tenant_context_required"),
    ],
)
def test_each_auth_error_maps_to_its_contract_code(error: AuthError, status: int, code: str) -> None:
    response = _client(error).get("/boom")
    assert response.status_code == status
    assert response.json()["code"] == code
    assert response.headers["content-type"].startswith("application/problem+json")


def test_no_membership_response_cannot_be_used_to_probe_tenant_existence() -> None:
    """A missing tenant and a forbidden tenant must be byte-identical to the caller."""

    missing = _client(NoMembershipError()).get("/boom").json()
    forbidden = _client(NoMembershipError()).get("/boom").json()
    assert missing == forbidden
    body = str(missing)
    for leak in ("tenant_id", "exists", "not found", "membership row"):
        assert leak not in body.lower()


def test_invalid_token_detail_never_echoes_the_token() -> None:
    response = _client(InvalidTokenError()).get("/boom")
    assert "eyJ" not in response.text

# HELM Stage 1 — Identity Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give FastAPI a real, verifiable authentication and authorization spine, ending with `GET /api/v1/tenants` returning the caller's actual memberships under row-level security with an audit trail.

**Architecture:** A verified JWT resolves to a global user, which resolves to an active tenant membership, which yields effective scopes, which gate an endpoint whose database work runs inside a transaction with `app.tenant_id` set. Five small modules, each with one responsibility: JWT verification, identity resolution, membership resolution, pure scope arithmetic, and FastAPI dependency wiring.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, Pydantic v2 / pydantic-settings, PyJWT + cryptography, pytest + pytest-asyncio, testcontainers, ruff, mypy strict.

**Spec:** `docs/superpowers/specs/2026-07-30-helm-stage-1-identity-spine-design.md`

## Global Constraints

- All work happens in `F:\Codes\HELM\helm-api`. Repo root is `F:\Codes\HELM`.
- Use the virtualenv at `helm-api/.venv`. On Windows the interpreter is `./.venv/Scripts/python.exe`. Every command below is run from `helm-api/`.
- **The existing 14 tests must stay green after every task.** Run `./.venv/Scripts/python.exe -m pytest -q` before every commit.
- **Three gates must pass before every commit:** `pytest`, `./.venv/Scripts/python.exe -m ruff check .`, and `./.venv/Scripts/python.exe -m mypy app`. mypy runs in `strict` mode; ruff enforces `E,F,I,UP,B,ASYNC` at line-length 120.
- `from __future__ import annotations` is the first import line of every new Python module, matching every existing file.
- Every module, class, and public function gets a one-line docstring. This codebase has them everywhere; ruff does not enforce it but reviewers will.
- **Never log, echo, or put in an error message:** a raw token, a JWKS private key, a connection string, or a database password. `unhandled_exception_handler` exists precisely so internals never reach a caller.
- **No error may distinguish "tenant does not exist" from "caller has no membership".** Both return the identical `no_membership` problem response.
- A tenant id is never trusted from a request body or token claim. `X-HELM-Active-Tenant` is a *hint* that must be validated against real membership rows.
- Identity is keyed on `(identity_issuer, identity_subject)`. Email is never an identity key.
- Money, dates, and enums follow existing conventions; this phase adds none of them.
- `helm-app/` is not touched by any task in this plan.

---

## File Structure

**Created:**
- `app/auth/__init__.py` — package marker
- `app/auth/errors.py` — the auth exception hierarchy, mapped to problem codes
- `app/auth/jwt_verifier.py` — JWKS cache + signature/claim validation
- `app/auth/scopes.py` — pure role→scope arithmetic, no I/O
- `app/auth/identity.py` — verified subject → global `User`
- `app/auth/membership.py` — user + tenant hint → active `TenantMembership`
- `app/api/deps.py` — FastAPI dependencies composing the above
- `app/api/v1/tenants.py` — the proving endpoint
- `app/db/repositories/identity.py` — user and membership queries
- `alembic/versions/20260730_02_identity_spine.py` — enum widening + idempotency table
- `tests/conftest.py` — shared fixtures (RSA keypair, JWKS, token factory)
- `tests/test_scopes.py`, `tests/test_jwt_verifier.py`, `tests/test_auth_errors.py`
- `tests/test_tenants_endpoint.py`
- `tests/test_identity_integration.py` — testcontainers red-team matrix

**Modified:**
- `app/config.py` — OIDC settings block
- `app/api/router.py` — mount the tenants router
- `app/main.py` — register auth exception handlers
- `app/db/models/membership.py` — widen `MembershipRole`
- `requirements.txt`, `requirements-dev.txt` — new dependencies

---

## Task 1: Dependencies and OIDC configuration

**Files:**
- Modify: `requirements.txt`
- Modify: `requirements-dev.txt`
- Modify: `app/config.py:21-70`
- Test: `tests/test_config_oidc.py` (create)

**Interfaces:**
- Consumes: existing `Settings`, `HelmEnvironment` from `app/config.py`
- Produces: `Settings.oidc_issuer: str | None`, `Settings.oidc_jwks_url: str | None`, `Settings.oidc_audience: str | None`, `Settings.oidc_allowed_algorithms: list[str]`, `Settings.oidc_jwks_cache_seconds: int`, `Settings.allow_dev_unassertion: bool`; `Settings.require_oidc() -> OidcSettings` where `OidcSettings` is a frozen dataclass with fields `issuer: str`, `jwks_url: str`, `audience: str`, `allowed_algorithms: tuple[str, ...]`, `jwks_cache_seconds: int`

- [ ] **Step 1: Add the runtime dependencies**

Append to `requirements.txt`:

```
pyjwt>=2.10,<3.0
cryptography>=44.0,<50.0
httpx>=0.27,<1.0
```

`httpx` moves from dev to runtime because the JWKS fetch needs it in production.

Append to `requirements-dev.txt`:

```
testcontainers[postgres]>=4.13,<5.0
respx>=0.22,<1.0
```

Install them:

```bash
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_config_oidc.py`:

```python
"""OIDC configuration must be complete or explicitly absent, never half-set."""

from __future__ import annotations

import pytest

from app.config import HelmEnvironment, Settings


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "helm_env": HelmEnvironment.TEST,
        "oidc_issuer": "https://issuer.test",
        "oidc_jwks_url": "https://issuer.test/jwks",
        "oidc_audience": "helm-api",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_require_oidc_returns_complete_settings() -> None:
    oidc = _settings().require_oidc()
    assert oidc.issuer == "https://issuer.test"
    assert oidc.jwks_url == "https://issuer.test/jwks"
    assert oidc.audience == "helm-api"
    assert oidc.allowed_algorithms == ("RS256",)


def test_require_oidc_rejects_partial_configuration() -> None:
    with pytest.raises(RuntimeError, match="OIDC"):
        _settings(oidc_jwks_url=None).require_oidc()


def test_symmetric_algorithms_are_refused() -> None:
    with pytest.raises(ValueError, match="asymmetric"):
        _settings(oidc_allowed_algorithms=["HS256"])


def test_none_algorithm_is_refused() -> None:
    with pytest.raises(ValueError, match="asymmetric"):
        _settings(oidc_allowed_algorithms=["none"])


def test_dev_bypass_cannot_be_enabled_in_production() -> None:
    with pytest.raises(ValueError, match="staging or production"):
        _settings(helm_env=HelmEnvironment.PRODUCTION, allow_dev_unassertion=True)


def test_dev_bypass_allowed_in_local() -> None:
    assert _settings(helm_env=HelmEnvironment.LOCAL, allow_dev_unassertion=True).allow_dev_unassertion is True
```

The symmetric-algorithm test matters: allowing `HS256` alongside an RSA JWKS is the classic algorithm-confusion vector, where an attacker signs a token using the *public* key as an HMAC secret. Refusing symmetric algorithms at config time removes the vector.

The `allow_dev_unassertion` flag is the BFF-assertion bypass `auth-contract.md` permits in local/test only, and it requires a startup hard failure in staging/production.

- [ ] **Step 3: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_config_oidc.py -q`
Expected: FAIL — `Settings` has no attribute `oidc_issuer` / no `require_oidc`.

- [ ] **Step 4: Implement the configuration**

In `app/config.py`, add this import to the existing `from __future__` block area:

```python
from dataclasses import dataclass
```

Add the frozen dataclass above `class Settings`:

```python
ASYMMETRIC_ALGORITHMS = frozenset({"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"})


@dataclass(frozen=True, slots=True)
class OidcSettings:
    """Complete, validated OIDC verification settings."""

    issuer: str
    jwks_url: str
    audience: str
    allowed_algorithms: tuple[str, ...]
    jwks_cache_seconds: int
```

Inside `class Settings`, add these fields after `database_migration_url`:

```python
    oidc_issuer: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str | None = None
    oidc_allowed_algorithms: list[str] = Field(default_factory=lambda: ["RS256"])
    oidc_jwks_cache_seconds: int = 300
    allow_dev_unassertion: bool = False
```

Add these validators inside `class Settings`:

```python
    @field_validator("oidc_allowed_algorithms")
    @classmethod
    def validate_algorithms(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("OIDC_ALLOWED_ALGORITHMS must not be empty")
        unsupported = [algorithm for algorithm in value if algorithm not in ASYMMETRIC_ALGORITHMS]
        if unsupported:
            raise ValueError(
                "OIDC_ALLOWED_ALGORITHMS must contain only asymmetric algorithms; "
                "symmetric or 'none' algorithms permit token forgery against a public JWKS"
            )
        return value
```

Extend the existing `reject_unsafe_production_settings` validator body, before its `return self`:

```python
        if self.allow_dev_unassertion and self.helm_env in {HelmEnvironment.STAGING, HelmEnvironment.PRODUCTION}:
            raise ValueError("ALLOW_DEV_UNASSERTION must never be enabled in staging or production")
```

Add this method to `Settings`:

```python
    def require_oidc(self) -> OidcSettings:
        """Return complete OIDC settings or refuse to serve authenticated traffic."""

        missing = [
            name
            for name, value in (
                ("OIDC_ISSUER", self.oidc_issuer),
                ("OIDC_JWKS_URL", self.oidc_jwks_url),
                ("OIDC_AUDIENCE", self.oidc_audience),
            )
            if value is None or not value.strip()
        ]
        if missing:
            raise RuntimeError(f"OIDC configuration is incomplete; missing: {', '.join(missing)}")
        assert self.oidc_issuer is not None and self.oidc_jwks_url is not None and self.oidc_audience is not None
        return OidcSettings(
            issuer=self.oidc_issuer,
            jwks_url=self.oidc_jwks_url,
            audience=self.oidc_audience,
            allowed_algorithms=tuple(self.oidc_allowed_algorithms),
            jwks_cache_seconds=self.oidc_jwks_cache_seconds,
        )
```

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 20 passed (14 existing + 6 new), ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add requirements.txt requirements-dev.txt app/config.py tests/test_config_oidc.py
git commit -m "feat(config): provider-agnostic OIDC settings refusing symmetric algorithms"
```

---

## Task 2: The auth error hierarchy

**Files:**
- Create: `app/auth/__init__.py`
- Create: `app/auth/errors.py`
- Modify: `app/main.py:16-46`
- Test: `tests/test_auth_errors.py` (create)

**Interfaces:**
- Consumes: `problem_response` from `app/core/errors.py`
- Produces: `AuthError` (base, with `status_code: int`, `code: str`, `title: str`, `detail: str`); subclasses `InvalidTokenError`, `InsufficientScopeError`, `NoMembershipError`, `TenantContextRequiredError`; `auth_exception_handler(request, exc) -> JSONResponse`

Note: `app/auth/errors.py` defines a class named `InvalidTokenError`, and PyJWT also exports one. Task 3 imports PyJWT's as `jwt.InvalidTokenError` via the module, never by bare name, so they never collide.

- [ ] **Step 1: Write the failing test**

Create `tests/test_auth_errors.py`:

```python
"""Auth failures must map to safe, non-enumerable problem responses."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.errors import (
    AuthError,
    InsufficientScopeError,
    InvalidTokenError,
    NoMembershipError,
    TenantContextRequiredError,
    auth_exception_handler,
)


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_auth_errors.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 3: Create the package and errors**

Create `app/auth/__init__.py`:

```python
"""Authentication and authorization primitives for the HELM control plane."""
```

Create `app/auth/errors.py`:

```python
"""Auth failures expressed as safe, non-enumerable problem responses."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.errors import problem_response


class AuthError(Exception):
    """Base class for every authentication or authorization failure.

    Detail strings are deliberately generic. They never echo a token, a tenant
    id, or whether a resource exists, so responses cannot be used to enumerate
    tenants or probe membership.
    """

    status_code: int = 401
    code: str = "invalid_token"
    title: str = "Unauthorized"
    detail: str = "Authentication failed."


class InvalidTokenError(AuthError):
    """The bearer token was missing, malformed, expired, or failed verification."""

    status_code = 401
    code = "invalid_token"
    title = "Unauthorized"
    detail = "The access token is missing or not valid."


class InsufficientScopeError(AuthError):
    """A verified caller lacked the scope an endpoint requires."""

    status_code = 403
    code = "insufficient_scope"
    title = "Forbidden"
    detail = "The caller does not have the required scope."


class NoMembershipError(AuthError):
    """A verified caller has no active membership in the requested tenant.

    This is intentionally identical for a tenant that does not exist and a
    tenant the caller may not access.
    """

    status_code = 403
    code = "no_membership"
    title = "Forbidden"
    detail = "The caller does not have access to the requested tenant."


class TenantContextRequiredError(AuthError):
    """No tenant was selected and the endpoint defines no safe default."""

    status_code = 400
    code = "tenant_context_required"
    title = "Bad Request"
    detail = "A tenant selection is required for this request."


async def auth_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render an AuthError without leaking internals to the caller."""

    if not isinstance(exc, AuthError):
        raise exc
    return problem_response(
        request,
        status_code=exc.status_code,
        title=exc.title,
        code=exc.code,
        detail=exc.detail,
    )
```

- [ ] **Step 4: Register the handler**

In `app/main.py`, add the import beside the other `app.core` import:

```python
from app.auth.errors import AuthError, auth_exception_handler
```

In `create_app`, add this line immediately after `application.add_exception_handler(StarletteHTTPException, http_exception_handler)`:

```python
    application.add_exception_handler(AuthError, auth_exception_handler)
```

Register it before the generic `Exception` handler so `AuthError` is matched by its specific handler.

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 26 passed, ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add app/auth/__init__.py app/auth/errors.py app/main.py tests/test_auth_errors.py
git commit -m "feat(auth): non-enumerable problem responses for auth failures"
```

---

## Task 3: JWT verifier with JWKS caching

**Files:**
- Create: `app/auth/jwt_verifier.py`
- Create: `tests/conftest.py`
- Test: `tests/test_jwt_verifier.py` (create)

**Interfaces:**
- Consumes: `OidcSettings` from `app/config.py`; `InvalidTokenError` from `app/auth/errors.py`
- Produces: frozen dataclass `VerifiedSubject` with fields `issuer: str`, `subject: str`, `email: str | None`, `token_id: str`, `expires_at: int`; class `JwtVerifier` with `__init__(self, settings: OidcSettings, client: httpx.AsyncClient)`, `async verify(self, token: str) -> VerifiedSubject`, and `async _jwks(self) -> PyJWKSet` (private)

- [ ] **Step 1: Write the shared fixtures**

Create `tests/conftest.py`:

```python
"""Shared cryptographic fixtures: a real RSA keypair and a JWKS served in-memory."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

TEST_ISSUER = "https://issuer.test"
TEST_AUDIENCE = "helm-api"
TEST_KID = "test-key-1"


@dataclass(frozen=True, slots=True)
class SigningKey:
    """A test RSA keypair plus the JWKS document that publishes its public half."""

    private_pem: bytes
    jwks: dict[str, Any]
    kid: str


@pytest.fixture(scope="session")
def signing_key() -> SigningKey:
    """Generate one 2048-bit RSA key for the whole test session."""

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_jwk: dict[str, Any] = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    public_jwk.update({"kid": TEST_KID, "use": "sig", "alg": "RS256"})
    return SigningKey(private_pem=private_pem, jwks={"keys": [public_jwk]}, kid=TEST_KID)


@pytest.fixture
def make_token(signing_key: SigningKey) -> Callable[..., str]:
    """Build a signed token, overriding any claim or header for negative tests."""

    def _make(
        *,
        subject: str = "subject-1",
        issuer: str = TEST_ISSUER,
        audience: str = TEST_AUDIENCE,
        expires_in: int = 300,
        issued_ago: int = 0,
        not_before_in: int | None = None,
        kid: str | None = None,
        algorithm: str = "RS256",
        key: bytes | None = None,
        **extra_claims: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": subject,
            "iss": issuer,
            "aud": audience,
            "exp": now + expires_in,
            "iat": now - issued_ago,
            "jti": f"jti-{now}-{subject}",
        }
        if not_before_in is not None:
            claims["nbf"] = now + not_before_in
        claims.update(extra_claims)
        return jwt.encode(
            claims,
            key if key is not None else signing_key.private_pem,
            algorithm=algorithm,
            headers={"kid": kid if kid is not None else signing_key.kid},
        )

    return _make
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_jwt_verifier.py`:

```python
"""The verifier is the security boundary; every rejection path is tested."""

from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from app.auth.errors import InvalidTokenError
from app.auth.jwt_verifier import JwtVerifier
from app.config import OidcSettings
from tests.conftest import TEST_AUDIENCE, TEST_ISSUER, SigningKey

JWKS_URL = "https://issuer.test/jwks"


def _settings(**overrides: object) -> OidcSettings:
    base: dict[str, object] = {
        "issuer": TEST_ISSUER,
        "jwks_url": JWKS_URL,
        "audience": TEST_AUDIENCE,
        "allowed_algorithms": ("RS256",),
        "jwks_cache_seconds": 300,
    }
    base.update(overrides)
    return OidcSettings(**base)  # type: ignore[arg-type]


def _verifier(signing_key: SigningKey, counter: list[int] | None = None, **overrides: object) -> JwtVerifier:
    def handler(request: httpx.Request) -> httpx.Response:
        if counter is not None:
            counter.append(1)
        return httpx.Response(200, json=signing_key.jwks)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return JwtVerifier(_settings(**overrides), client)


@pytest.mark.asyncio
async def test_accepts_a_correctly_signed_token(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    verified = await _verifier(signing_key).verify(make_token(subject="user-42", email="a@test.helm"))
    assert verified.subject == "user-42"
    assert verified.issuer == TEST_ISSUER
    assert verified.email == "a@test.helm"


@pytest.mark.asyncio
async def test_rejects_expired_token(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(make_token(expires_in=-10))


@pytest.mark.asyncio
async def test_rejects_not_yet_valid_token(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(make_token(not_before_in=600))


@pytest.mark.asyncio
async def test_rejects_wrong_audience(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(make_token(audience="some-other-api"))


@pytest.mark.asyncio
async def test_rejects_wrong_issuer(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(make_token(issuer="https://evil.test"))


@pytest.mark.asyncio
async def test_rejects_unknown_kid(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(make_token(kid="not-a-real-kid"))


@pytest.mark.asyncio
async def test_rejects_token_with_no_kid_header(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(make_token(kid=""))


@pytest.mark.asyncio
async def test_rejects_alg_none_token(signing_key: SigningKey) -> None:
    """The classic bypass: an unsigned token claiming algorithm 'none'."""

    import jwt as pyjwt

    forged = pyjwt.encode({"sub": "evil", "iss": TEST_ISSUER, "aud": TEST_AUDIENCE}, None, algorithm=None)
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(forged)


@pytest.mark.asyncio
async def test_rejects_tampered_payload(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    import base64
    import json

    header, payload, signature = make_token(subject="honest").split(".")
    decoded = json.loads(base64.urlsafe_b64decode(payload + "=="))
    decoded["sub"] = "attacker"
    swapped = base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode().rstrip("=")
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(f"{header}.{swapped}.{signature}")


@pytest.mark.asyncio
async def test_rejects_garbage_and_empty_input(signing_key: SigningKey) -> None:
    for candidate in ["", "   ", "not.a.token", "a.b", "....."]:
        with pytest.raises(InvalidTokenError):
            await _verifier(signing_key).verify(candidate)


@pytest.mark.asyncio
async def test_rejects_token_missing_required_claims(
    signing_key: SigningKey, make_token: Callable[..., str]
) -> None:
    import jwt as pyjwt

    incomplete = pyjwt.encode(
        {"iss": TEST_ISSUER, "aud": TEST_AUDIENCE, "exp": 9999999999},
        signing_key.private_pem,
        algorithm="RS256",
        headers={"kid": signing_key.kid},
    )
    with pytest.raises(InvalidTokenError):
        await _verifier(signing_key).verify(incomplete)


@pytest.mark.asyncio
async def test_jwks_is_cached_across_calls(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    fetches: list[int] = []
    verifier = _verifier(signing_key, counter=fetches)
    await verifier.verify(make_token())
    await verifier.verify(make_token())
    assert len(fetches) == 1


@pytest.mark.asyncio
async def test_jwks_refetched_after_cache_expiry(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    fetches: list[int] = []
    verifier = _verifier(signing_key, counter=fetches, jwks_cache_seconds=0)
    await verifier.verify(make_token())
    await verifier.verify(make_token())
    assert len(fetches) == 2


@pytest.mark.asyncio
async def test_jwks_fetch_failure_is_an_auth_error_not_a_crash(signing_key: SigningKey, make_token: Callable[..., str]) -> None:
    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    verifier = JwtVerifier(_settings(), httpx.AsyncClient(transport=httpx.MockTransport(failing)))
    with pytest.raises(InvalidTokenError):
        await verifier.verify(make_token())
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_jwt_verifier.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth.jwt_verifier'`.

- [ ] **Step 4: Implement the verifier**

Create `app/auth/jwt_verifier.py`:

```python
"""Provider-agnostic OIDC access-token verification against a cached JWKS."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWKSet

from app.auth.errors import InvalidTokenError
from app.config import OidcSettings

REQUIRED_CLAIMS = ["exp", "iat", "jti", "sub", "iss", "aud"]


@dataclass(frozen=True, slots=True)
class VerifiedSubject:
    """A cryptographically verified token subject; carries no authorization."""

    issuer: str
    subject: str
    email: str | None
    token_id: str
    expires_at: int


class JwtVerifier:
    """Verifies bearer tokens against the configured issuer's published JWKS.

    This class knows nothing about which issuer it is talking to. Everything
    comes from OidcSettings, so swapping Keycloak for a shared OIDC provider or
    BFF-minted delegation JWTs is a configuration change, never a code change.
    """

    def __init__(self, settings: OidcSettings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._cached_jwks: PyJWKSet | None = None
        self._cached_at: float = 0.0

    async def _jwks(self) -> PyJWKSet:
        """Return the issuer's JWKS, refetching only when the cache has expired."""

        age = time.monotonic() - self._cached_at
        if self._cached_jwks is not None and age < self._settings.jwks_cache_seconds:
            return self._cached_jwks
        try:
            response = await self._client.get(self._settings.jwks_url)
            response.raise_for_status()
            jwks = PyJWKSet.from_dict(response.json())
        except Exception as error:
            raise InvalidTokenError from error
        self._cached_jwks = jwks
        self._cached_at = time.monotonic()
        return jwks

    async def verify(self, token: str) -> VerifiedSubject:
        """Verify signature and claims, or raise InvalidTokenError."""

        candidate = token.strip()
        if not candidate:
            raise InvalidTokenError

        try:
            header: dict[str, Any] = jwt.get_unverified_header(candidate)
        except jwt.PyJWTError as error:
            raise InvalidTokenError from error

        key_id = header.get("kid")
        if not key_id:
            raise InvalidTokenError

        jwks = await self._jwks()
        try:
            signing_key = jwks[key_id]
        except (KeyError, jwt.PyJWTError) as error:
            raise InvalidTokenError from error

        try:
            claims: dict[str, Any] = jwt.decode(
                candidate,
                signing_key,
                algorithms=list(self._settings.allowed_algorithms),
                audience=self._settings.audience,
                issuer=self._settings.issuer,
                options={"require": REQUIRED_CLAIMS, "verify_signature": True},
            )
        except jwt.PyJWTError as error:
            raise InvalidTokenError from error

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise InvalidTokenError

        email = claims.get("email")
        return VerifiedSubject(
            issuer=str(claims["iss"]),
            subject=subject,
            email=email if isinstance(email, str) else None,
            token_id=str(claims["jti"]),
            expires_at=int(claims["exp"]),
        )
```

Two details worth understanding. The `algorithms` list comes from configuration that Task 1 already restricted to asymmetric algorithms, so an `alg: none` or `HS256` token is refused before signature checking. And `_jwks` catches broadly on purpose: a JWKS endpoint that is down, slow, or serving malformed JSON is an authentication failure, not a 500 — the caller learns only that their token was not accepted.

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 40 passed, ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add app/auth/jwt_verifier.py tests/conftest.py tests/test_jwt_verifier.py
git commit -m "feat(auth): JWKS-backed JWT verification with full rejection matrix"
```

---

## Task 4: Pure scope arithmetic

**Files:**
- Create: `app/auth/scopes.py`
- Modify: `app/db/models/membership.py:17-21`
- Test: `tests/test_scopes.py` (create)

**Interfaces:**
- Consumes: `MembershipRole` from `app/db/models/membership.py`
- Produces: `Scope` (StrEnum with members `TENANT_READ`, `CAMPAIGN_READ`, `CAMPAIGN_WRITE`, `APPROVAL_READ`, `APPROVAL_DECIDE`, `CREATIVE_READ`, `CREATIVE_WRITE`, `INTEGRATION_READ`, `INTEGRATION_WRITE`, `MEMBER_READ`, `MEMBER_WRITE`, `AUDIT_READ`); `ROLE_DEFAULT_SCOPES: Mapping[MembershipRole, frozenset[Scope]]`; `effective_scopes(role, grants, restrictions) -> frozenset[Scope]`

- [ ] **Step 1: Widen the role enum**

In `app/db/models/membership.py`, replace the `MembershipRole` class body so all six roles exist:

```python
class MembershipRole(StrEnum):
    OWNER = "owner"
    AGENCY_ADMIN = "agency_admin"
    STRATEGIST = "strategist"
    CREATIVE = "creative"
    ANALYST = "analyst"
    CLIENT_VIEWER = "client_viewer"
```

The database enum is widened by the migration in Task 6. Widening the Python enum first is safe because nothing reads the new values until then.

- [ ] **Step 2: Write the failing test**

Create `tests/test_scopes.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_scopes.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth.scopes'`.

- [ ] **Step 4: Implement the scopes**

Create `app/auth/scopes.py`:

```python
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
```

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 51 passed, ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add app/auth/scopes.py app/db/models/membership.py tests/test_scopes.py
git commit -m "feat(auth): pure scope arithmetic with role ceilings for six roles"
```

---

## Task 5: Identity and membership repositories

**Files:**
- Create: `app/db/repositories/identity.py`
- Create: `app/auth/identity.py`
- Create: `app/auth/membership.py`
- Test: `tests/test_membership_resolution.py` (create)

**Interfaces:**
- Consumes: `VerifiedSubject` (Task 3); `Scope`, `effective_scopes` (Task 4); `User`, `TenantMembership`, `MembershipRole`, `MembershipStatus`, `UserStatus` models; `NoMembershipError`, `TenantContextRequiredError` (Task 2)
- Produces:
  - `IdentityRepository` with `async find_user(session, issuer: str, subject: str) -> User | None` and `async list_active_memberships(session, user_id: UUID) -> list[MembershipRow]`
  - frozen dataclass `MembershipRow` with fields `membership_id: UUID`, `tenant_id: UUID`, `tenant_slug: str`, `tenant_name: str`, `role: MembershipRole`, `scope_grants: list[str]`, `scope_restrictions: list[str]`
  - frozen dataclass `AuthenticatedCaller` with fields `user_id: UUID`, `issuer: str`, `subject: str`, `membership_id: UUID`, `tenant_id: UUID`, `tenant_slug: str`, `role: MembershipRole`, `scopes: frozenset[Scope]`, and method `has(scope: Scope) -> bool`
  - `select_membership(memberships: Sequence[MembershipRow], tenant_hint: str | None) -> MembershipRow`

- [ ] **Step 1: Write the failing test**

Create `tests/test_membership_resolution.py`:

```python
"""Membership selection decides which tenant a request acts in; it must be explicit."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.auth.errors import NoMembershipError, TenantContextRequiredError
from app.auth.membership import select_membership
from app.db.repositories.identity import MembershipRow
from app.db.models.membership import MembershipRole


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_membership_resolution.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth.membership'`.

- [ ] **Step 3: Implement the repository**

Create `app/db/repositories/identity.py`:

```python
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
```

Ordering is explicit because an unordered multi-row result makes the acting tenant plan-dependent — the same defect Phase A's migration 0008 had to fix after it caused a silent privilege change.

- [ ] **Step 4: Implement identity and membership selection**

Create `app/auth/identity.py`:

```python
"""Resolve a verified token subject to a global HELM user."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.errors import NoMembershipError
from app.auth.jwt_verifier import VerifiedSubject
from app.db.repositories.identity import IdentityRepository


@dataclass(frozen=True, slots=True)
class ResolvedIdentity:
    """A verified subject matched to a provisioned, active HELM user."""

    user_id: UUID
    issuer: str
    subject: str


async def resolve_identity(
    session: AsyncSession,
    repository: IdentityRepository,
    verified: VerifiedSubject,
) -> ResolvedIdentity:
    """Match a verified subject to a user, without auto-provisioning.

    A valid token for an unknown subject is refused with the same error as a
    missing membership. Stage 1 never creates users implicitly; provisioning is
    an audited administrative command in a later phase.
    """

    user = await repository.find_user(session, verified.issuer, verified.subject)
    if user is None:
        raise NoMembershipError
    return ResolvedIdentity(user_id=user.id, issuer=verified.issuer, subject=verified.subject)
```

Create `app/auth/membership.py`:

```python
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
```

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 58 passed, ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add app/db/repositories/identity.py app/auth/identity.py app/auth/membership.py tests/test_membership_resolution.py
git commit -m "feat(auth): identity resolution and explicit tenant membership selection"
```

---

## Task 6: Migration — widen the role enum and add idempotency keys

**Files:**
- Create: `alembic/versions/20260730_02_identity_spine.py`
- Test: `tests/test_migration_identity_spine.py` (create)

**Interfaces:**
- Consumes: revision `20260727_01` as `down_revision` (the file is named
  `20260727_01_foundation.py` but its `revision` string is `20260727_01` — the
  chain uses the revision string, not the filename)
- Produces: enum values `strategist`, `creative`, `analyst` on `tenant_membership_role`; table `idempotency_keys` with forced RLS

- [ ] **Step 1: Confirm the parent revision id**

Run: `./.venv/Scripts/python.exe -m alembic heads`

Expected: `20260727_01 (head)`. Use exactly this string as `down_revision` below. If it differs, use what this command prints — a wrong `down_revision` silently detaches the migration chain.

- [ ] **Step 2: Write the failing test**

This test asserts on the migration source, so it runs without a database. Create `tests/test_migration_identity_spine.py`:

```python
"""The identity-spine migration must widen roles and isolate idempotency keys."""

from __future__ import annotations

from pathlib import Path

import pytest

MIGRATION = Path(__file__).parents[1] / "alembic" / "versions" / "20260730_02_identity_spine.py"


@pytest.fixture(scope="module")
def source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


@pytest.mark.parametrize("role", ["strategist", "creative", "analyst"])
def test_adds_each_new_role_value(source: str, role: str) -> None:
    assert f"'{role}'" in source


def test_creates_the_idempotency_table(source: str) -> None:
    assert "idempotency_keys" in source


def test_idempotency_keys_are_tenant_scoped_with_forced_rls(source: str) -> None:
    assert "tenant_id" in source
    assert "enable row level security" in source
    assert "force row level security" in source
    assert "helm_tenant_id()" in source


def test_idempotency_keys_are_unique_per_tenant(source: str) -> None:
    assert "uq_idempotency_keys_tenant_key" in source


def test_migration_is_reversible(source: str) -> None:
    assert "def downgrade()" in source
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_migration_identity_spine.py -q`
Expected: FAIL — the migration file does not exist.

- [ ] **Step 4: Write the migration**

Create `alembic/versions/20260730_02_identity_spine.py`:

```python
"""Widen membership roles and add tenant-scoped idempotency keys.

Revision ID: 20260730_02
Revises: 20260727_01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260730_02"
down_revision = "20260727_01"
branch_labels = None
depends_on = None

NEW_ROLES = ("strategist", "creative", "analyst")


def upgrade() -> None:
    """Add the three missing roles and create the idempotency ledger."""

    for role in NEW_ROLES:
        op.execute(f"alter type tenant_membership_role add value if not exists '{role}'")

    op.create_table(
        "idempotency_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("request_fingerprint", sa.String(128), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_idempotency_keys_tenant_key"),
    )
    op.create_index("ix_idempotency_keys_tenant_created", "idempotency_keys", ["tenant_id", "created_at"])

    op.execute("alter table idempotency_keys enable row level security")
    op.execute("alter table idempotency_keys force row level security")
    op.execute(
        "create policy idempotency_keys_tenant_isolation on idempotency_keys "
        "using (tenant_id = helm_tenant_id()) "
        "with check (tenant_id = helm_tenant_id())"
    )


def downgrade() -> None:
    """Drop the idempotency ledger.

    PostgreSQL cannot remove a value from an enum type, so the three added roles
    are intentionally not reverted. Re-running upgrade is safe because each add
    uses 'if not exists'.
    """

    op.execute("drop policy if exists idempotency_keys_tenant_isolation on idempotency_keys")
    op.execute("alter table idempotency_keys no force row level security")
    op.execute("alter table idempotency_keys disable row level security")
    op.drop_index("ix_idempotency_keys_tenant_created", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
```

`alter type ... add value` cannot run inside a transaction block on older PostgreSQL. If `alembic upgrade head` fails with "ALTER TYPE ... ADD VALUE cannot run inside a transaction block", set `transaction_per_migration = True` in `alembic/env.py`'s `context.configure(...)` call, or split the enum change into its own revision. On PostgreSQL 12+ this generally works as written.

- [ ] **Step 5: Run test to verify it passes**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_migration_identity_spine.py -q`
Expected: PASS — 7 tests.

- [ ] **Step 6: Run the gates and commit**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
git add alembic/versions/20260730_02_identity_spine.py tests/test_migration_identity_spine.py
git commit -m "feat(db): widen membership roles and add tenant-scoped idempotency keys"
```

---

## Task 7: FastAPI dependency wiring

**Files:**
- Create: `app/api/deps.py`
- Modify: `app/main.py` (engine and verifier lifespan)
- Test: `tests/test_deps.py` (create)

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: `get_settings(request) -> Settings`; `get_session_factory(request) -> async_sessionmaker[AsyncSession]`; `get_verifier(request) -> JwtVerifier`; `bearer_token(request) -> str`; `async current_caller(request, ...) -> AuthenticatedCaller`; `require_scope(scope: Scope) -> Callable[..., Awaitable[AuthenticatedCaller]]`

- [ ] **Step 1: Write the failing test**

Create `tests/test_deps.py`:

```python
"""Header parsing and scope gating, isolated from the database."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import Request

from app.api.deps import bearer_token, require_scope
from app.auth.errors import InsufficientScopeError, InvalidTokenError
from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import Scope
from app.db.models.membership import MembershipRole


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_deps.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.deps'`.

- [ ] **Step 3: Implement the dependencies**

Create `app/api/deps.py`:

```python
"""FastAPI dependencies composing verification, identity, membership and scope."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.errors import InsufficientScopeError, InvalidTokenError
from app.auth.identity import resolve_identity
from app.auth.jwt_verifier import JwtVerifier
from app.auth.membership import AuthenticatedCaller, build_caller, select_membership
from app.auth.scopes import Scope
from app.config import Settings
from app.db.repositories.identity import IdentityRepository

TENANT_HINT_HEADER = "X-HELM-Active-Tenant"


def get_settings(request: Request) -> Settings:
    """Return the settings bound to the running application."""

    settings: Settings = request.app.state.settings
    return settings


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    """Return the application session factory created at startup."""

    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    return factory


def get_verifier(request: Request) -> JwtVerifier:
    """Return the process-wide verifier so its JWKS cache is shared."""

    verifier: JwtVerifier = request.app.state.jwt_verifier
    return verifier


def bearer_token(request: Request) -> str:
    """Extract a bearer token, refusing anything malformed."""

    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        raise InvalidTokenError
    return value.strip()


async def current_caller(
    request: Request,
    token: str = Depends(bearer_token),
    verifier: JwtVerifier = Depends(get_verifier),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> AuthenticatedCaller:
    """Verify the token and resolve the caller's tenant membership and scopes.

    The tenant header is only a selection hint. It is matched against the
    caller's own memberships, so it can never widen access.
    """

    verified = await verifier.verify(token)
    repository = IdentityRepository()
    async with session_factory() as session:
        identity = await resolve_identity(session, repository, verified)
        memberships = await repository.list_active_memberships(session, identity.user_id)
    membership = select_membership(memberships, request.headers.get(TENANT_HINT_HEADER))
    return build_caller(identity.user_id, identity.issuer, identity.subject, membership)


def require_scope(scope: Scope) -> Callable[[AuthenticatedCaller], Awaitable[AuthenticatedCaller]]:
    """Build a dependency that admits only callers holding the given scope."""

    async def guard(caller: AuthenticatedCaller = Depends(current_caller)) -> AuthenticatedCaller:
        if not caller.has(scope):
            raise InsufficientScopeError
        return caller

    return guard
```

- [ ] **Step 4: Wire startup state**

In `app/main.py`, add these imports:

```python
import httpx

from app.auth.jwt_verifier import JwtVerifier
from app.db.session import create_database_engine, create_session_factory
```

In `create_app`, immediately before `application.include_router(api_router)`, add:

```python
    if app_settings.database_url is not None:
        engine = create_database_engine(app_settings)
        application.state.session_factory = create_session_factory(engine)
    if app_settings.oidc_issuer is not None:
        application.state.jwt_verifier = JwtVerifier(app_settings.require_oidc(), httpx.AsyncClient(timeout=5.0))
```

Both are conditional so the existing health tests, which construct the app with no database and no OIDC configuration, keep passing unchanged.

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 68 passed, ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/deps.py app/main.py tests/test_deps.py
git commit -m "feat(api): dependency chain from bearer token to scoped caller"
```

---

## Task 8: The proving endpoint

**Files:**
- Create: `app/api/v1/tenants.py`
- Modify: `app/api/router.py`
- Test: `tests/test_tenants_endpoint.py` (create)

**Interfaces:**
- Consumes: `require_scope`, `current_caller`, `get_session_factory` (Task 7); `Scope` (Task 4); `AuditRepository`, `AuditEvent` from `app/db/repositories/audit.py`; `tenant_scoped_transaction`, `TenantContext` from `app/db/tenant_context.py`
- Produces: `GET /api/v1/tenants` returning `TenantListResponse` with `data: list[TenantSummary]` and `meta: ContextMeta`

- [ ] **Step 1: Write the failing test**

Create `tests/test_tenants_endpoint.py`:

```python
"""The proving endpoint exercises the whole chain with dependency overrides."""

from __future__ import annotations

from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.deps import current_caller
from app.auth.errors import NoMembershipError
from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import ROLE_DEFAULT_SCOPES
from app.config import HelmEnvironment, Settings
from app.db.models.membership import MembershipRole
from app.main import create_app


def _caller(role: MembershipRole = MembershipRole.OWNER) -> AuthenticatedCaller:
    return AuthenticatedCaller(
        user_id=uuid4(),
        issuer="https://issuer.test",
        subject="subject-1",
        membership_id=uuid4(),
        tenant_id=uuid4(),
        tenant_slug="finnovate",
        role=role,
        scopes=ROLE_DEFAULT_SCOPES[role],
    )


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings(helm_env=HelmEnvironment.TEST))
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def test_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/tenants")
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


def test_rejects_a_forged_token(client: TestClient) -> None:
    response = client.get("/api/v1/tenants", headers={"Authorization": "Bearer forged.token.value"})
    assert response.status_code == 401


def test_valid_identity_without_membership_is_forbidden(client: TestClient) -> None:
    async def no_membership() -> AuthenticatedCaller:
        raise NoMembershipError

    client.app.dependency_overrides[current_caller] = no_membership
    response = client.get("/api/v1/tenants", headers={"Authorization": "Bearer any"})
    assert response.status_code == 403
    assert response.json()["code"] == "no_membership"


def test_authenticated_caller_receives_their_context(client: TestClient) -> None:
    caller = _caller()

    async def override() -> AuthenticatedCaller:
        return caller

    client.app.dependency_overrides[current_caller] = override
    response = client.get("/api/v1/tenants", headers={"Authorization": "Bearer any"})
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["tenant_slug"] == "finnovate"
    assert body["meta"]["role"] == "owner"
    assert "tenant:read" in body["meta"]["scopes"]


def test_response_never_contains_a_token_or_connection_string(client: TestClient) -> None:
    async def override() -> AuthenticatedCaller:
        return _caller()

    client.app.dependency_overrides[current_caller] = override
    text = client.get("/api/v1/tenants", headers={"Authorization": "Bearer secret.jwt.value"}).text
    assert "secret.jwt.value" not in text
    assert "postgresql://" not in text


def test_client_viewer_still_reads_their_tenant(client: TestClient) -> None:
    async def override() -> AuthenticatedCaller:
        return _caller(MembershipRole.CLIENT_VIEWER)

    client.app.dependency_overrides[current_caller] = override
    assert client.get("/api/v1/tenants", headers={"Authorization": "Bearer any"}).status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_tenants_endpoint.py -q`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Implement the endpoint**

Create `app/api/v1/tenants.py`:

```python
"""The Stage 1 proving endpoint: the caller's own tenant memberships."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app.api.deps import require_scope
from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import Scope

router = APIRouter(tags=["tenants"])


class TenantSummary(BaseModel):
    """A tenant the caller may act in."""

    model_config = ConfigDict(extra="forbid")

    id: str
    slug: str
    name: str


class ContextMeta(BaseModel):
    """Non-authoritative presentation context for UI gating only.

    The BFF must not treat this as an authorization decision; every request is
    re-evaluated server-side.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: str
    tenant_slug: str
    role: str
    scopes: list[str]


class TenantListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[TenantSummary]
    meta: ContextMeta


@router.get("/tenants", response_model=TenantListResponse, summary="List the caller's tenants")
async def list_tenants(
    caller: AuthenticatedCaller = Depends(require_scope(Scope.TENANT_READ)),
) -> TenantListResponse:
    """Return the active tenant context resolved for this caller."""

    return TenantListResponse(
        data=[
            TenantSummary(
                id=str(caller.tenant_id),
                slug=caller.tenant_slug,
                name=caller.tenant_slug.replace("-", " ").title(),
            )
        ],
        meta=ContextMeta(
            tenant_id=str(caller.tenant_id),
            tenant_slug=caller.tenant_slug,
            role=caller.role.value,
            scopes=sorted(scope.value for scope in caller.scopes),
        ),
    )
```

- [ ] **Step 4: Mount the router**

In `app/api/router.py`, add the import and include:

```python
from app.api.v1.tenants import router as tenants_router
```

```python
api_router.include_router(tenants_router)
```

- [ ] **Step 5: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 74 passed, ruff clean, mypy clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/tenants.py app/api/router.py tests/test_tenants_endpoint.py
git commit -m "feat(api): GET /api/v1/tenants proving the authorization chain"
```

---

## Task 9: Red-team integration tests on real PostgreSQL

**Files:**
- Create: `tests/test_identity_integration.py`
- Test: the file is the deliverable

**Interfaces:**
- Consumes: `testcontainers.postgres.PostgresContainer`; the Alembic migration chain; `IdentityRepository`, `select_membership`, `build_caller`; `AuditRepository`, `AuditEvent`; `tenant_scoped_transaction`, `TenantContext`
- Produces: the four security guarantees `open-decisions.md` requires

- [ ] **Step 1: Write the integration test**

Create `tests/test_identity_integration.py`:

```python
"""Red-team matrix on real PostgreSQL: isolation, revocation, scope, audit atomicity.

Skips when Docker is unavailable, matching test_rls_integration.py, so the suite
stays green on machines without a running daemon.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.auth.errors import NoMembershipError
from app.auth.membership import build_caller, select_membership
from app.auth.scopes import Scope
from app.db.models.membership import MembershipRole
from app.db.repositories.identity import IdentityRepository

PROJECT_ROOT = Path(__file__).parents[1]

try:
    from testcontainers.postgres import PostgresContainer

    DOCKER_IMPORTABLE = True
except ImportError:  # pragma: no cover - environment dependent
    DOCKER_IMPORTABLE = False

pytestmark = pytest.mark.skipif(not DOCKER_IMPORTABLE, reason="testcontainers is not installed")


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    """Start a disposable PostgreSQL container and migrate it to head."""

    try:
        container = PostgresContainer("postgres:16-alpine")
        container.start()
    except Exception as error:  # pragma: no cover - environment dependent
        pytest.skip(f"Docker is not available for integration tests: {type(error).__name__}")

    try:
        sync_url = container.get_connection_url()
        async_url = sync_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
        environment = os.environ.copy()
        environment["DATABASE_MIGRATION_URL"] = async_url
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=PROJECT_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            pytest.fail(f"Alembic could not migrate the container database: {result.stderr[-800:]}")
        yield async_url
    finally:
        container.stop()


@pytest_asyncio.fixture
async def engine(postgres_url: str) -> AsyncIterator[AsyncEngine]:
    database_engine = create_async_engine(postgres_url, pool_pre_ping=True)
    try:
        yield database_engine
    finally:
        await database_engine.dispose()


async def _seed(engine: AsyncEngine) -> dict[str, UUID]:
    """Create two tenants, one user with a membership in each, committed."""

    ids = {
        "tenant_a": uuid4(),
        "tenant_b": uuid4(),
        "user": uuid4(),
        "membership_a": uuid4(),
        "membership_b": uuid4(),
    }
    async with engine.begin() as connection:
        for key, slug in (("tenant_a", "alpha"), ("tenant_b", "beta")):
            await connection.execute(
                text(
                    "insert into tenants (id, slug, name, plan, status) "
                    "values (:id, :slug, :name, 'test', 'active')"
                ),
                {"id": str(ids[key]), "slug": f"{slug}-{ids[key].hex[:8]}", "name": slug.title()},
            )
        await connection.execute(
            text(
                "insert into users (id, identity_issuer, identity_subject, email_normalized, display_name, status) "
                "values (:id, 'https://issuer.test', :subject, :email, 'Integration User', 'active')"
            ),
            {"id": str(ids["user"]), "subject": f"subject-{ids['user']}", "email": f"u-{ids['user'].hex[:8]}@test.helm"},
        )
        for membership, tenant, role in (
            ("membership_a", "tenant_a", "owner"),
            ("membership_b", "tenant_b", "client_viewer"),
        ):
            await connection.execute(
                text(
                    "insert into tenant_memberships (id, tenant_id, user_id, role, status) "
                    "values (:id, :tenant_id, :user_id, :role, 'active')"
                ),
                {
                    "id": str(ids[membership]),
                    "tenant_id": str(ids[tenant]),
                    "user_id": str(ids["user"]),
                    "role": role,
                },
            )
    return ids


@pytest.mark.asyncio
async def test_widened_roles_are_accepted_by_the_database(engine: AsyncEngine) -> None:
    """Migration 02 must make strategist, creative and analyst real enum values."""

    async with engine.begin() as connection:
        result = await connection.execute(
            text("select unnest(enum_range(null::tenant_membership_role))::text")
        )
        values = {row[0] for row in result.all()}
    assert {"strategist", "creative", "analyst"} <= values


@pytest.mark.asyncio
async def test_identity_uniqueness_constraints_still_hold(engine: AsyncEngine) -> None:
    """Stage 1 relies on constraints created by migration 01; prove they exist.

    Without uq_users_identity_issuer_subject, one issuer subject could map to two
    users, making identity resolution ambiguous. Without
    uq_tenant_memberships_tenant_user, a user could hold two conflicting roles in
    one tenant.
    """

    async with engine.connect() as connection:
        result = await connection.execute(
            text("select conname from pg_constraint where conname = any(:names)"),
            {"names": ["uq_users_identity_issuer_subject", "uq_tenant_memberships_tenant_user"]},
        )
        found = {row[0] for row in result.all()}
    assert found == {"uq_users_identity_issuer_subject", "uq_tenant_memberships_tenant_user"}


@pytest.mark.asyncio
async def test_cross_tenant_rows_are_invisible_under_rls(engine: AsyncEngine) -> None:
    """Tenant A's context must not see tenant B's rows."""

    ids = await _seed(engine)
    async with engine.connect() as connection:
        bypass = await connection.execute(text("select rolbypassrls from pg_roles where rolname = current_user"))
        if bypass.scalar_one():
            pytest.skip("Container superuser bypasses RLS; isolation assertions would be vacuous.")

        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, false)"),
            {"tenant_id": str(ids["tenant_a"])},
        )
        foreign = await connection.execute(
            text("select id from tenant_memberships where tenant_id = :tenant_id"),
            {"tenant_id": str(ids["tenant_b"])},
        )
        assert foreign.all() == []


@pytest.mark.asyncio
async def test_suspended_membership_disappears_from_resolution(engine: AsyncEngine) -> None:
    """Revocation must take effect immediately, regardless of an unexpired token."""

    ids = await _seed(engine)
    repository = IdentityRepository()
    from sqlalchemy.ext.asyncio import async_sessionmaker

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        before = await repository.list_active_memberships(session, ids["user"])
    assert len(before) == 2

    async with engine.begin() as connection:
        await connection.execute(
            text("update tenant_memberships set status = 'suspended' where id = :id"),
            {"id": str(ids["membership_b"])},
        )

    async with factory() as session:
        after = await repository.list_active_memberships(session, ids["user"])
    assert len(after) == 1
    assert after[0].membership_id == ids["membership_a"]


@pytest.mark.asyncio
async def test_scope_denial_for_a_client_viewer(engine: AsyncEngine) -> None:
    """A real client-viewer row must not yield an approval-decide scope."""

    ids = await _seed(engine)
    from sqlalchemy.ext.asyncio import async_sessionmaker

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        memberships = await IdentityRepository().list_active_memberships(session, ids["user"])

    viewer = next(row for row in memberships if row.role == MembershipRole.CLIENT_VIEWER)
    caller = build_caller(ids["user"], "https://issuer.test", "subject-1", viewer)
    assert not caller.has(Scope.APPROVAL_DECIDE)
    assert caller.has(Scope.TENANT_READ)


@pytest.mark.asyncio
async def test_unknown_tenant_hint_is_refused(engine: AsyncEngine) -> None:
    ids = await _seed(engine)
    from sqlalchemy.ext.asyncio import async_sessionmaker

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        memberships = await IdentityRepository().list_active_memberships(session, ids["user"])

    with pytest.raises(NoMembershipError):
        select_membership(memberships, tenant_hint="a-tenant-that-is-not-theirs")


@pytest.mark.asyncio
async def test_audit_and_action_commit_atomically(engine: AsyncEngine) -> None:
    """A rolled-back transaction must leave no audit row behind."""

    ids = await _seed(engine)
    audit_id = uuid4()

    async with engine.connect() as connection:
        transaction = await connection.begin()
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(ids["tenant_a"])},
        )
        await connection.execute(
            text(
                "insert into audit_log (id, tenant_id, actor_type, actor_id, action, target, request_id) "
                "values (:id, :tenant_id, 'user', 'integration', 'test.action', 'target', 'req-1')"
            ),
            {"id": str(audit_id), "tenant_id": str(ids["tenant_a"])},
        )
        await transaction.rollback()

    async with engine.connect() as connection:
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, false)"),
            {"tenant_id": str(ids["tenant_a"])},
        )
        found = await connection.execute(text("select id from audit_log where id = :id"), {"id": str(audit_id)})
        assert found.all() == []
```

- [ ] **Step 2: Run with Docker running**

Start Docker Desktop, then run:

```bash
./.venv/Scripts/python.exe -m pytest tests/test_identity_integration.py -q
```

Expected: 7 passed. If Docker is not running, expected: 7 skipped with a clear reason — that is an acceptable local outcome, but the tests must be run at least once with Docker up before this task is considered done.

- [ ] **Step 3: Run the gates**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

Expected: 81 passed (or 74 passed + 7 skipped without Docker), ruff clean, mypy clean.

Test counts throughout this plan are guides, not assertions. If your count differs
by a test or two, that is fine — what matters is that nothing fails and the 14
pre-existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_identity_integration.py
git commit -m "test(security): red-team identity matrix on containerised PostgreSQL"
```

---

## Task 10: Documentation and environment template

**Files:**
- Create: `helm-api/.env.example`
- Modify: `helm-api/README.md`
- Modify: `docs/open-decisions.md`

**Interfaces:**
- Consumes: the settings names from Task 1
- Produces: no code interfaces; this task closes the phase

- [ ] **Step 1: Write the environment template**

Create `helm-api/.env.example`:

```
# HELM API environment template. Copy to .env and fill in. Never commit .env.

HELM_ENV=local
LOG_LEVEL=INFO
CORS_ORIGINS=["http://localhost:3000"]

# Application connection. Must authenticate as a role that CANNOT bypass RLS.
DATABASE_URL=

# Privileged unpooled connection used only by Alembic migrations.
DATABASE_MIGRATION_URL=

# OIDC verification. Provider-agnostic: any standards-compliant issuer works.
# The final production issuer is still an open decision; these values are the
# only thing that needs to change when it is settled.
OIDC_ISSUER=
OIDC_JWKS_URL=
OIDC_AUDIENCE=helm-api
OIDC_ALLOWED_ALGORITHMS=["RS256"]
OIDC_JWKS_CACHE_SECONDS=300

# Local/test only. Permits omitting the BFF workload assertion while the BFF
# does not exist. Startup fails if this is true in staging or production.
ALLOW_DEV_UNASSERTION=false
```

- [ ] **Step 2: Document the phase in the README**

Append to `helm-api/README.md`:

```markdown
## Stage 1: identity, tenancy and transaction security

The API authenticates every request through a chain that is resolved entirely
server-side:

1. `JwtVerifier` validates the bearer token's signature against the issuer's
   published JWKS, plus `iss`, `aud`, `exp`, `nbf`, `iat`, `jti` and `sub`.
   Only asymmetric algorithms are permitted; configuration refuses `HS*` and
   `none`, which closes the algorithm-confusion and unsigned-token bypasses.
2. `resolve_identity` matches the verified `(issuer, subject)` pair to an active
   global user. Email is never an identity key, and users are never
   auto-provisioned.
3. `select_membership` picks the acting tenant. `X-HELM-Active-Tenant` is an
   untrusted hint matched against the caller's own memberships; it can never
   widen access. A caller with several memberships and no hint receives
   `tenant_context_required` rather than an implicit, plan-dependent choice.
4. `effective_scopes` computes permissions from the role, with grants capped by
   a per-role ceiling and restrictions always winning.

`GET /api/v1/tenants` exercises the whole chain.

### Verification

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
```

The red-team matrix in `tests/test_identity_integration.py` runs against a
disposable PostgreSQL container and covers cross-tenant denial, immediate
membership revocation, scope denial, and audit atomicity. It skips when Docker
is unavailable; run it with Docker started before merging security-relevant
changes.

### The OIDC issuer is deliberately not chosen

Verification is driven entirely by `OIDC_ISSUER`, `OIDC_JWKS_URL`,
`OIDC_AUDIENCE` and `OIDC_ALLOWED_ALGORITHMS`. Keycloak, a shared OIDC issuer,
or BFF-minted delegation JWTs all work without code changes, so
`open-decisions.md` items 1 and 5 stay genuinely open.
```

- [ ] **Step 3: Record what Stage 1 closed**

In `docs/open-decisions.md`, append this section at the end:

```markdown
## Stage 1 status (2026-07-30)

Implemented in `helm-api` and verified by the gates above:

- OIDC JWT verification against a configured JWKS, provider-agnostic
- Global `users` + `tenant_memberships` resolution with no auto-provisioning
- Six canonical roles with pure, ceiling-capped scope arithmetic
- Transaction-local RLS tenant context on every tenant-scoped query
- Append-only audit with atomicity proven under rollback
- Tenant-scoped idempotency key ledger

Still open and deliberately untouched: items 1 and 5 (the production issuer
choice), 2, 3, 4, 6, 7, 9 and 10. Item 8's canonical schema is now implemented
for identity and membership; its invitation lifecycle and client-safe resource
filters remain open.

The `users.tenant_id` risk listed above is resolved in `helm-api`, whose schema
uses global users plus memberships. It remains true of `helm-app`, which keeps
its own prototype database until the sub-project 3 BFF cutover.
```

- [ ] **Step 4: Run the gates and commit**

```bash
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
git add helm-api/.env.example helm-api/README.md docs/open-decisions.md
git commit -m "docs: Stage 1 identity spine contract, env template and status"
```

---

## Definition of done

- `GET /api/v1/tenants` returns the caller's real memberships, authenticated by a verified JWT, scoped by RLS, with audit written.
- All three gates clean: `pytest`, `ruff check .`, `mypy app`.
- The red-team matrix has been run at least once with Docker started, and passed.
- No token, key, connection string, or tenant-existence signal appears in any response body.

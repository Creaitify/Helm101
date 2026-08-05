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
async def test_jwks_fetch_failure_is_an_auth_error_not_a_crash(
    signing_key: SigningKey, make_token: Callable[..., str]
) -> None:
    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    verifier = JwtVerifier(_settings(), httpx.AsyncClient(transport=httpx.MockTransport(failing)))
    with pytest.raises(InvalidTokenError):
        await verifier.verify(make_token())

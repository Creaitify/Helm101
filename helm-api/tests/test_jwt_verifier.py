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
    """The classic bypass: an unsigned token claiming algorithm 'none', with a valid kid.

    Carrying signing_key.kid routes execution past the missing-kid guard and
    into jwt.decode's algorithms= allowlist, which is the actual defense being
    tested. A token with no kid at all is rejected earlier for an unrelated
    reason and would not exercise the allowlist; see
    test_rejects_token_with_no_kid_header for that separate case.
    """

    import jwt as pyjwt

    forged = pyjwt.encode(
        {"sub": "evil", "iss": TEST_ISSUER, "aud": TEST_AUDIENCE},
        None,
        algorithm=None,
        headers={"kid": signing_key.kid},
    )
    assert pyjwt.get_unverified_header(forged) == {"alg": "none", "kid": signing_key.kid, "typ": "JWT"}
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
async def test_unknown_kid_triggers_exactly_one_forced_refetch_then_succeeds(
    signing_key: SigningKey, make_token: Callable[..., str]
) -> None:
    """Simulates a key rotation: the cache holds only the old key, the issuer now serves

    both. A token signed with the new key must succeed after exactly one forced
    refetch, not be rejected for the rest of the TTL window.
    """

    old_kid = "old-key"
    old_public_jwk = dict(signing_key.jwks["keys"][0])
    old_public_jwk["kid"] = old_kid
    fetch_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal fetch_count
        fetch_count += 1
        if fetch_count == 1:
            # First fetch (during priming) only serves the old key.
            return httpx.Response(200, json={"keys": [old_public_jwk]})
        # Every fetch after rotation serves both keys, as a real issuer would
        # during the overlap window.
        return httpx.Response(200, json={"keys": [old_public_jwk, signing_key.jwks["keys"][0]]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    verifier = JwtVerifier(_settings(jwks_cache_seconds=300), client)

    # Prime the cache with only the old key.
    await verifier.verify(make_token(kid=old_kid))
    assert fetch_count == 1

    # A token signed with the new (rotated-in) key is not in the cached JWKS yet.
    new_token = make_token()
    verified = await verifier.verify(new_token)
    assert verified.subject == "subject-1"
    assert fetch_count == 2  # exactly one forced refetch


@pytest.mark.asyncio
async def test_repeated_kid_misses_within_the_rate_limit_window_do_not_refetch_repeatedly(
    signing_key: SigningKey, make_token: Callable[..., str]
) -> None:
    """An attacker sending tokens with random `kid` values must not be able to force

    unbounded JWKS fetches against the issuer (fetch-amplification DoS).
    """

    fetches: list[int] = []
    verifier = _verifier(signing_key, counter=fetches, jwks_cache_seconds=300)

    # Prime the cache.
    await verifier.verify(make_token())
    assert len(fetches) == 1

    # Many distinct unknown kids in quick succession must trigger at most one
    # additional forced refetch, not one per request.
    for index in range(10):
        with pytest.raises(InvalidTokenError):
            await verifier.verify(make_token(kid=f"random-kid-{index}"))

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


@pytest.mark.asyncio
async def test_a_genuine_programming_error_during_jwks_fetch_is_not_swallowed(
    signing_key: SigningKey, make_token: Callable[..., str]
) -> None:
    """A bug (e.g. an AttributeError from a typo) must propagate as a 500, not be

    laundered into a silent 401 that is indistinguishable from a real auth
    failure or a rotation-related outage.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        raise AttributeError("boom: simulated programming error, not a network failure")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    verifier = JwtVerifier(_settings(), client)
    with pytest.raises(AttributeError, match="boom"):
        await verifier.verify(make_token())

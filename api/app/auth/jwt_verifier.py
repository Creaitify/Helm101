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

# Minimum interval between forced JWKS refetches triggered by an unknown `kid`.
# A legitimate key rotation is a rare, human-scale event, so a floor measured
# in seconds is generous for recovering from it while still bounding how often
# an attacker can force a fetch against the issuer just by sending tokens with
# random `kid` values (fetch-amplification denial of service).
MIN_FORCED_REFETCH_INTERVAL_SECONDS = 10.0


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
        self._last_forced_refetch_at: float = float("-inf")

    async def _fetch_jwks(self) -> PyJWKSet:
        """Fetch and parse the issuer's JWKS document.

        Only the failure modes we actually mean to treat as an auth failure
        are caught here: a network/HTTP failure reaching the issuer
        (`httpx.HTTPError`), and a malformed JWKS document
        (`ValueError`/`KeyError` from `PyJWKSet.from_dict`, which parses JSON
        key material). Anything else — e.g. an `AttributeError` from a typo —
        is a genuine programming error and must propagate as a 500, not be
        laundered into a silent 401.
        """

        try:
            response = await self._client.get(self._settings.jwks_url)
            response.raise_for_status()
            return PyJWKSet.from_dict(response.json())
        except (httpx.HTTPError, ValueError, KeyError) as error:
            raise InvalidTokenError from error

    async def _jwks(self) -> PyJWKSet:
        """Return the issuer's JWKS, refetching only when the cache has expired."""

        age = time.monotonic() - self._cached_at
        if self._cached_jwks is not None and age < self._settings.jwks_cache_seconds:
            return self._cached_jwks
        jwks = await self._fetch_jwks()
        self._cached_jwks = jwks
        self._cached_at = time.monotonic()
        return jwks

    async def _jwks_forcing_refetch_on_unknown_kid(self) -> PyJWKSet:
        """Return the cached JWKS, forcing one refetch if it is rate-limit eligible.

        Used only after a `kid` lookup has already missed against the cached
        JWKS. A key rotation publishes a new `kid` before the old one is
        retired, so a miss against a stale cache is expected right after
        rotation, not necessarily an attack. Without this, a valid token
        signed with the new key is rejected for the full
        `jwks_cache_seconds` window — a scheduled outage on every rotation.

        The forced refetch itself is rate-limited by
        `MIN_FORCED_REFETCH_INTERVAL_SECONDS` so that repeatedly sending
        tokens with random `kid` values cannot drive unbounded JWKS fetches
        against the issuer.
        """

        now = time.monotonic()
        if now - self._last_forced_refetch_at < MIN_FORCED_REFETCH_INTERVAL_SECONDS:
            return await self._jwks()
        self._last_forced_refetch_at = now
        jwks = await self._fetch_jwks()
        self._cached_jwks = jwks
        self._cached_at = now
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
        except (KeyError, jwt.PyJWTError):
            # Unknown kid against the cached JWKS: this is expected right
            # after the issuer rotates its signing keys, so force one
            # rate-limited refetch and retry before giving up.
            jwks = await self._jwks_forcing_refetch_on_unknown_kid()
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

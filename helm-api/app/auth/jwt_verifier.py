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

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

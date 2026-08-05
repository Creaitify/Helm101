"""Shared cryptographic and database-container fixtures for the test suite."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import subprocess
import sys
import time
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import jwt
import pytest
import pytest_asyncio
from app.db.models.tenant import Tenant, TenantStatus
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

TEST_ISSUER = "https://issuer.test"
TEST_AUDIENCE = "helm-api"
TEST_KID = "test-key-1"

PROJECT_ROOT = Path(__file__).parents[1]

try:
    from testcontainers.postgres import PostgresContainer

    DOCKER_IMPORTABLE = True
except ImportError:  # pragma: no cover - environment dependent
    DOCKER_IMPORTABLE = False


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


NON_BYPASS_ROLE = "helm_app_role"
# A fixed, module-level secret scoped to a disposable per-test-run container: it
# never touches a shared, staging, or production database, so there is nothing
# here for a leaked value to compromise. Fixed (not regenerated per module) so
# every test module that rewrites a connection URL via this role can agree on
# the same password without a fixture dependency between them.
NON_BYPASS_PASSWORD = secrets.token_hex(16)


async def _provision_non_bypass_role(superuser_url: str, password: str) -> None:
    """Create a login role without SUPERUSER/BYPASSRLS so RLS assertions are real.

    testcontainers' default PostgreSQL user is a superuser, and superusers
    implicitly bypass row-level security regardless of table policies. Without
    this role, cross-tenant RLS tests could only ever observe rows because the
    connection ignores every policy, not because isolation holds.
    """

    engine = create_async_engine(superuser_url, pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(f"create role {NON_BYPASS_ROLE} login nosuperuser nobypassrls password '{password}'")
            )
            await connection.execute(text(f"grant all privileges on all tables in schema public to {NON_BYPASS_ROLE}"))
            await connection.execute(
                text(f"grant all privileges on all sequences in schema public to {NON_BYPASS_ROLE}")
            )
            await connection.execute(
                text(f"grant execute on function helm_lookup_active_memberships(text, text) to {NON_BYPASS_ROLE}")
            )
            await connection.execute(
                text(f"grant execute on function helm_lookup_active_tenant_by_slug(text) to {NON_BYPASS_ROLE}")
            )
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    """Start a disposable PostgreSQL container and migrate it to head.

    Yields the superuser connection URL testcontainers provisions by default.
    Most tests using this fixture (via the `engine` fixture) use that superuser
    connection for setup and assertions that are not themselves proving an RLS
    property, matching test_tenants_endpoint.py's pg_engine. That is a
    convenience for fixture setup, not a workaround for a gap: the production
    request path (app/api/deps.py::current_caller, via
    IdentityRepository.list_active_memberships) resolves memberships through
    `helm_lookup_active_memberships`, a narrow SECURITY DEFINER function
    (alembic/versions/20260805_04_membership_lookup_function.py) that works
    correctly under a genuinely non-bypass role. That is proved directly by
    tests/test_identity_integration.py::test_membership_resolution_works_under_
    non_bypass_role, which connects as the provisioned non-bypass role, not the
    superuser.

    Module-scoped so every test module that requests it (directly or via the
    `engine`/`session_factory`/`provisioned_tenant` fixtures below) shares one
    container instead of paying container-startup cost per module.
    """

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
        asyncio.run(_provision_non_bypass_role(async_url, NON_BYPASS_PASSWORD))
        yield async_url
    finally:
        container.stop()


@pytest_asyncio.fixture
async def engine(postgres_url: str) -> AsyncIterator[AsyncEngine]:
    """A per-test engine bound to the container's superuser connection URL."""

    database_engine = create_async_engine(postgres_url, pool_pre_ping=True)
    try:
        yield database_engine
    finally:
        await database_engine.dispose()


@pytest_asyncio.fixture
async def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """A session factory bound to the containerised test database."""

    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def provisioned_tenant(engine: AsyncEngine) -> Tenant:
    """Create one active tenant for provisioning tests to attach members to.

    The slug is suffixed with a random hex fragment because the container is
    module-scoped: a fixed slug would collide with a row left by an earlier
    test in the same module against the unique index on tenants.slug.
    """

    tenant_id = uuid4()
    slug = f"acme-{tenant_id.hex[:8]}"
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "insert into tenants (id, slug, name, plan, status) "
                "values (:id, :slug, 'Acme', 'test', 'active')"
            ),
            {"id": str(tenant_id), "slug": slug},
        )
    return Tenant(id=tenant_id, slug=slug, name="Acme", status=TenantStatus.ACTIVE)

"""The proving endpoint exercises the whole chain with dependency overrides."""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from app.api.deps import current_caller, get_session_factory
from app.auth.errors import NoMembershipError
from app.auth.jwt_verifier import JwtVerifier
from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import ROLE_DEFAULT_SCOPES
from app.config import HelmEnvironment, OidcSettings, Settings
from app.db.models.membership import MembershipRole
from app.db.session import create_session_factory
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from tests.conftest import TEST_AUDIENCE, TEST_ISSUER, SigningKey

SAFE_TEST_DATABASE_ENV = "HELM_TEST_DATABASE_URL"
TEST_DATABASE_URL = os.getenv(SAFE_TEST_DATABASE_ENV)
PROJECT_ROOT = Path(__file__).parents[1]
JWKS_URL = "https://issuer.test/jwks"


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
def client(signing_key: SigningKey) -> Iterator[TestClient]:
    """A test app with a real verifier bound to an in-memory JWKS, so a forged
    token is genuinely rejected by signature verification rather than by a
    missing dependency.

    `current_caller` also depends on a session factory as a sibling
    dependency, resolved before the token is verified, so a placeholder
    factory is required even though the forged-token path never reaches the
    database: verification fails first and the request never uses it.
    """

    app = create_app(Settings(helm_env=HelmEnvironment.TEST))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=signing_key.jwks)

    oidc_settings = OidcSettings(
        issuer=TEST_ISSUER,
        jwks_url=JWKS_URL,
        audience=TEST_AUDIENCE,
        allowed_algorithms=("RS256",),
        jwks_cache_seconds=300,
    )
    app.state.jwt_verifier = JwtVerifier(oidc_settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    app.state.session_factory = create_session_factory(create_async_engine("postgresql+asyncpg://unused/unused"))
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


def test_response_never_contains_a_token_or_connection_string(client: TestClient) -> None:
    async def override() -> AuthenticatedCaller:
        raise NoMembershipError

    client.app.dependency_overrides[current_caller] = override
    text_body = client.get("/api/v1/tenants", headers={"Authorization": "Bearer secret.jwt.value"}).text
    assert "secret.jwt.value" not in text_body
    assert "postgresql://" not in text_body


# --- Real-Postgres-gated tests -------------------------------------------------
#
# The endpoint reads the real `tenants` row and writes a real audit row inside a
# tenant-scoped transaction. Tenant/AuditLog models use native PostgreSQL JSONB
# and enum columns, so this path cannot be exercised against SQLite or a mock
# session — it needs a real, disposable PostgreSQL database. This follows the
# exact gating pattern used in tests/test_rls_integration.py: skip cleanly
# unless HELM_TEST_DATABASE_URL names a disposable test database.

pg_only = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason=(
        "Real-database proving tests require an isolated disposable PostgreSQL database. "
        "Set HELM_TEST_DATABASE_URL; never use shared, staging, or production databases."
    ),
)


def _require_disposable_postgres_url(url: str) -> None:
    """Require an explicit test-named PostgreSQL database before any migration command."""

    if not url.startswith(("postgresql://", "postgresql+asyncpg://")):
        pytest.fail("HELM_TEST_DATABASE_URL must be a PostgreSQL URL; SQLite is not supported for these tests.")
    database_name = url.rsplit("/", maxsplit=1)[-1].split("?", maxsplit=1)[0].lower()
    if "test" not in database_name:
        pytest.fail("HELM_TEST_DATABASE_URL must name an isolated disposable database containing 'test'.")


@pytest.fixture(scope="session", autouse=True)
def migrate_disposable_database() -> Iterator[None]:
    """Bring only the declared disposable test database to the Alembic head revision."""

    if not TEST_DATABASE_URL:
        yield
        return
    _require_disposable_postgres_url(TEST_DATABASE_URL)
    migration_environment = os.environ.copy()
    migration_environment["DATABASE_MIGRATION_URL"] = TEST_DATABASE_URL
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=PROJECT_ROOT,
        env=migration_environment,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail("Alembic could not migrate the declared disposable test database.")
    yield


@pytest_asyncio.fixture
async def pg_engine() -> AsyncIterator[AsyncEngine]:
    """Use the application role URL against the disposable test database."""

    assert TEST_DATABASE_URL is not None
    engine = create_async_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    try:
        yield engine
    finally:
        await engine.dispose()


async def _seed_tenant_and_membership(
    engine: AsyncEngine, tenant_id: str, user_id: str, membership_id: str, slug: str, name: str
) -> None:
    """Seed one active user, tenant and membership under a rollback-free real transaction."""

    async with engine.begin() as connection:
        await connection.execute(text("select set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": ""})
        await connection.execute(
            text(
                "insert into users (id, identity_issuer, identity_subject, email_normalized, display_name, status) "
                "values (:id, 'https://issuer.test', :subject, :email, 'Prover', 'active')"
            ),
            {"id": user_id, "subject": f"subject-{user_id}", "email": f"{user_id[:8]}@test.helm"},
        )
        await connection.execute(
            text("insert into tenants (id, slug, name, plan, status) values (:id, :slug, :name, 'test', 'active')"),
            {"id": tenant_id, "slug": slug, "name": name},
        )
        await connection.execute(
            text(
                "insert into tenant_memberships (id, tenant_id, user_id, role, status) "
                "values (:id, :tenant_id, :user_id, 'owner', 'active')"
            ),
            {"id": membership_id, "tenant_id": tenant_id, "user_id": user_id},
        )


def _client_for(app_settings: Settings, engine: AsyncEngine, caller: AuthenticatedCaller) -> TestClient:
    """Build a TestClient wired to a real engine and a fixed authenticated caller."""

    app = create_app(app_settings)
    session_factory = create_session_factory(engine)

    async def override_caller() -> AuthenticatedCaller:
        return caller

    def override_session_factory() -> object:
        return session_factory

    app.dependency_overrides[current_caller] = override_caller
    app.dependency_overrides[get_session_factory] = override_session_factory
    return TestClient(app, raise_server_exceptions=False)


@pg_only
@pytest.mark.asyncio
async def test_tenant_name_reflects_the_database_row_not_the_slug(pg_engine: AsyncEngine) -> None:
    """A regression to slug-derived fabrication must fail this test."""

    tenant_id, user_id, membership_id = uuid4(), uuid4(), uuid4()
    real_name = "ACME Financial"
    slug = f"acme-{tenant_id.hex[:8]}"
    await _seed_tenant_and_membership(pg_engine, str(tenant_id), str(user_id), str(membership_id), slug, real_name)

    caller = AuthenticatedCaller(
        user_id=user_id,
        issuer="https://issuer.test",
        subject=f"subject-{user_id}",
        membership_id=membership_id,
        tenant_id=tenant_id,
        tenant_slug=slug,
        role=MembershipRole.OWNER,
        scopes=ROLE_DEFAULT_SCOPES[MembershipRole.OWNER],
    )

    with _client_for(Settings(helm_env=HelmEnvironment.TEST), pg_engine, caller) as test_client:
        response = test_client.get("/api/v1/tenants", headers={"Authorization": "Bearer any"})

    assert response.status_code == 200
    body = response.json()
    assert body["data"][0]["name"] == real_name
    fabricated_name = slug.replace("-", " ").title()
    assert body["data"][0]["name"] != fabricated_name

    async with pg_engine.begin() as connection:
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": str(tenant_id)}
        )
        audit_rows = await connection.execute(
            text("select action from audit_log where tenant_id = :tenant_id and action = 'tenant.context.read'"),
            {"tenant_id": str(tenant_id)},
        )
        assert len(audit_rows.all()) == 1


@pg_only
@pytest.mark.asyncio
async def test_client_viewer_still_reads_their_tenant(pg_engine: AsyncEngine) -> None:
    """Every role with tenant:read, not just owner, can reach the endpoint."""

    tenant_id, user_id, membership_id = uuid4(), uuid4(), uuid4()
    slug = f"viewer-{tenant_id.hex[:8]}"
    await _seed_tenant_and_membership(pg_engine, str(tenant_id), str(user_id), str(membership_id), slug, "Viewer Co")

    caller = AuthenticatedCaller(
        user_id=user_id,
        issuer="https://issuer.test",
        subject=f"subject-{user_id}",
        membership_id=membership_id,
        tenant_id=tenant_id,
        tenant_slug=slug,
        role=MembershipRole.CLIENT_VIEWER,
        scopes=ROLE_DEFAULT_SCOPES[MembershipRole.CLIENT_VIEWER],
    )

    with _client_for(Settings(helm_env=HelmEnvironment.TEST), pg_engine, caller) as test_client:
        response = test_client.get("/api/v1/tenants", headers={"Authorization": "Bearer any"})

    assert response.status_code == 200

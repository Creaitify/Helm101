"""Red-team matrix on real PostgreSQL: isolation, revocation, scope, audit atomicity.

Skips when Docker is unavailable, matching test_rls_integration.py, so the suite
stays green on machines without a running daemon.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import subprocess
import sys
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from app.auth.errors import NoMembershipError
from app.auth.jwt_verifier import JwtVerifier
from app.auth.membership import build_caller, select_membership
from app.auth.scopes import Scope
from app.config import HelmEnvironment, OidcSettings, Settings
from app.db.models.audit import AuditActorType
from app.db.models.membership import MembershipRole
from app.db.models.tenant import Tenant
from app.db.repositories.audit import AuditEvent, AuditRepository
from app.db.repositories.identity import IdentityRepository
from app.db.session import create_session_factory
from app.db.tenant_context import TenantContext, tenant_scoped_transaction
from app.main import create_app
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from tests.conftest import TEST_AUDIENCE, SigningKey

PROJECT_ROOT = Path(__file__).parents[1]

try:
    from testcontainers.postgres import PostgresContainer

    DOCKER_IMPORTABLE = True
except ImportError:  # pragma: no cover - environment dependent
    DOCKER_IMPORTABLE = False

pytestmark = pytest.mark.skipif(not DOCKER_IMPORTABLE, reason="testcontainers is not installed")


NON_BYPASS_ROLE = "helm_app_role"
NON_BYPASS_PASSWORD = secrets.token_hex(16)

SEED_ISSUER = "https://issuer.test"


def _seed_subject(user_id: UUID) -> str:
    """Return the deterministic identity_subject `_seed` assigns to a seeded user."""

    return f"subject-{user_id}"


async def _provision_non_bypass_role(superuser_url: str) -> None:
    """Create a login role without SUPERUSER/BYPASSRLS so RLS assertions are real.

    testcontainers' default PostgreSQL user is a superuser, and superusers
    implicitly bypass row-level security regardless of table policies. Without
    this role, the cross-tenant RLS test could only ever observe rows because
    the connection ignores every policy, not because isolation holds.
    """

    engine = create_async_engine(superuser_url, pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    f"create role {NON_BYPASS_ROLE} login nosuperuser nobypassrls "
                    f"password '{NON_BYPASS_PASSWORD}'"
                )
            )
            await connection.execute(text(f"grant all privileges on all tables in schema public to {NON_BYPASS_ROLE}"))
            await connection.execute(
                text(f"grant all privileges on all sequences in schema public to {NON_BYPASS_ROLE}")
            )
            await connection.execute(
                text(
                    "grant execute on function helm_lookup_active_memberships(text, text) "
                    f"to {NON_BYPASS_ROLE}"
                )
            )
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    """Start a disposable PostgreSQL container and migrate it to head.

    Yields the superuser connection URL testcontainers provisions by default.
    Most tests in this file still use that superuser connection (via the
    `engine` fixture) for setup and assertions that are not themselves proving
    an RLS property, matching test_tenants_endpoint.py's pg_engine. That is a
    convenience for fixture setup, not a workaround for a gap: the production
    request path (app/api/deps.py::current_caller, via
    IdentityRepository.list_active_memberships) now resolves memberships
    through `helm_lookup_active_memberships`, a narrow SECURITY DEFINER
    function (alembic/versions/20260805_04_membership_lookup_function.py,
    adapted from the precedent in
    helm-app/db/migrations/0008_membership_lookup_all.sql) that works
    correctly under a genuinely non-bypass role. That is proved directly by
    test_membership_resolution_works_under_non_bypass_role below, which
    connects as the provisioned non-bypass role, not the superuser.
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
        asyncio.run(_provision_non_bypass_role(async_url))
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


def _non_bypass_url(superuser_url: str) -> str:
    """Rewrite a superuser connection URL to use the provisioned non-bypass role."""

    prefix, _, rest = superuser_url.partition("@")
    scheme = prefix.split("://", 1)[0]
    return f"{scheme}://{NON_BYPASS_ROLE}:{NON_BYPASS_PASSWORD}@{rest}"


async def _seed(engine: AsyncEngine) -> dict[str, UUID]:
    """Create two tenants, one user with a membership in each, committed.

    `tenants` and `tenant_memberships` are FORCE ROW LEVEL SECURITY with
    `WITH CHECK (... = helm_tenant_id())`, so `app.tenant_id` must be set to the
    tenant being inserted before each such insert, mirroring
    tests/test_rls_integration.py's `_insert_tenant_fixture_data` and
    tests/test_tenants_endpoint.py's `_seed_tenant_and_membership`. `users` has
    no RLS policy, so it is unaffected by the current context setting.
    """

    ids = {
        "tenant_a": uuid4(),
        "tenant_b": uuid4(),
        "user": uuid4(),
        "membership_a": uuid4(),
        "membership_b": uuid4(),
    }
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "insert into users (id, identity_issuer, identity_subject, email_normalized, display_name, status) "
                "values (:id, :issuer, :subject, :email, 'Integration User', 'active')"
            ),
            {
                "id": str(ids["user"]),
                "issuer": SEED_ISSUER,
                "subject": _seed_subject(ids["user"]),
                "email": f"u-{ids['user'].hex[:8]}@test.helm",
            },
        )
        for key, slug, membership, role in (
            ("tenant_a", "alpha", "membership_a", "owner"),
            ("tenant_b", "beta", "membership_b", "client_viewer"),
        ):
            await connection.execute(
                text("select set_config('app.tenant_id', :tenant_id, true)"),
                {"tenant_id": str(ids[key])},
            )
            await connection.execute(
                text(
                    "insert into tenants (id, slug, name, plan, status) "
                    "values (:id, :slug, :name, 'test', 'active')"
                ),
                {"id": str(ids[key]), "slug": f"{slug}-{ids[key].hex[:8]}", "name": slug.title()},
            )
            await connection.execute(
                text(
                    "insert into tenant_memberships (id, tenant_id, user_id, role, status) "
                    "values (:id, :tenant_id, :user_id, :role, 'active')"
                ),
                {
                    "id": str(ids[membership]),
                    "tenant_id": str(ids[key]),
                    "user_id": str(ids["user"]),
                    "role": role,
                },
            )
    return ids


@pytest.mark.asyncio
async def test_widened_roles_are_accepted_by_the_database(engine: AsyncEngine) -> None:
    """Migration 02 must make strategist, creative and analyst real enum values."""

    async with engine.begin() as connection:
        result = await connection.execute(text("select unnest(enum_range(null::tenant_membership_role))::text"))
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
async def test_cross_tenant_rows_are_invisible_under_rls(engine: AsyncEngine, postgres_url: str) -> None:
    """Tenant A's context must not see tenant B's tenants or tenant_memberships rows.

    Connects as the non-bypass role provisioned in the postgres_url fixture
    (not the container's superuser `engine`), so this assertion is only true
    because the RLS policy holds - a superuser connection would pass this
    check vacuously regardless of whether the policy works at all. Checks both
    FORCE-RLS tables the fixture seeds (tenants, tenant_memberships); audit_log
    isolation is covered separately by test_audit_and_action_commit_atomically
    and tests/test_rls_integration.py.
    """

    ids = await _seed(engine)
    non_bypass_engine = create_async_engine(_non_bypass_url(postgres_url), pool_pre_ping=True)
    try:
        async with non_bypass_engine.connect() as connection:
            bypass = await connection.execute(text("select rolbypassrls from pg_roles where rolname = current_user"))
            assert bypass.scalar_one() is False, "test role must not bypass RLS or this assertion is vacuous"

            await connection.execute(
                text("select set_config('app.tenant_id', :tenant_id, false)"),
                {"tenant_id": str(ids["tenant_a"])},
            )
            foreign_memberships = await connection.execute(
                text("select id from tenant_memberships where tenant_id = :tenant_id"),
                {"tenant_id": str(ids["tenant_b"])},
            )
            assert foreign_memberships.all() == []

            foreign_tenant = await connection.execute(
                text("select id from tenants where id = :tenant_id"),
                {"tenant_id": str(ids["tenant_b"])},
            )
            assert foreign_tenant.all() == []
    finally:
        await non_bypass_engine.dispose()


@pytest.mark.asyncio
async def test_suspended_membership_disappears_from_resolution(engine: AsyncEngine) -> None:
    """A suspended membership must stop resolving, checked by calling the repository directly."""

    ids = await _seed(engine)
    repository = IdentityRepository()

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        before = await repository.list_active_memberships(session, SEED_ISSUER, _seed_subject(ids["user"]))
    assert len(before) == 2

    async with engine.begin() as connection:
        await connection.execute(
            text("update tenant_memberships set status = 'suspended' where id = :id"),
            {"id": str(ids["membership_b"])},
        )

    async with factory() as session:
        after = await repository.list_active_memberships(session, SEED_ISSUER, _seed_subject(ids["user"]))
    assert len(after) == 1
    assert after[0].membership_id == ids["membership_a"]


@pytest.mark.asyncio
async def test_invited_but_never_accepted_membership_never_resolves(engine: AsyncEngine) -> None:
    """An invited-but-not-yet-accepted membership must never resolve as a caller.

    MembershipStatus has no explicit 'revoked' member (ACTIVE, INVITED,
    SUSPENDED); 'revoked' access is represented either by row deletion or by a
    membership that was created but never left the 'invited' state. This is
    the more dangerous half of "revoked and suspended membership denial": a
    user who was invited but never accepted must not silently gain access as
    if they were already an active member.
    """

    ids = await _seed(engine)
    invited_membership_id = uuid4()
    invited_tenant_id = uuid4()
    async with engine.begin() as connection:
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(invited_tenant_id)},
        )
        await connection.execute(
            text(
                "insert into tenants (id, slug, name, plan, status) "
                "values (:id, :slug, :name, 'test', 'active')"
            ),
            {
                "id": str(invited_tenant_id),
                "slug": f"gamma-{invited_tenant_id.hex[:8]}",
                "name": "Gamma",
            },
        )
        await connection.execute(
            text(
                "insert into tenant_memberships (id, tenant_id, user_id, role, status) "
                "values (:id, :tenant_id, :user_id, 'analyst', 'invited')"
            ),
            {"id": str(invited_membership_id), "tenant_id": str(invited_tenant_id), "user_id": str(ids["user"])},
        )

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        resolved = await IdentityRepository().list_active_memberships(session, SEED_ISSUER, _seed_subject(ids["user"]))
    resolved_ids = {row.membership_id for row in resolved}
    assert invited_membership_id not in resolved_ids
    assert resolved_ids == {ids["membership_a"], ids["membership_b"]}


@pytest.mark.asyncio
async def test_scope_denial_for_a_client_viewer(engine: AsyncEngine) -> None:
    """A real client-viewer row must not yield an approval-decide scope."""

    ids = await _seed(engine)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        memberships = await IdentityRepository().list_active_memberships(
            session, SEED_ISSUER, _seed_subject(ids["user"])
        )

    viewer = next(row for row in memberships if row.role == MembershipRole.CLIENT_VIEWER)
    caller = build_caller(ids["user"], "https://issuer.test", "subject-1", viewer)
    assert not caller.has(Scope.APPROVAL_DECIDE)
    assert caller.has(Scope.TENANT_READ)


@pytest.mark.asyncio
async def test_unknown_tenant_hint_is_refused(engine: AsyncEngine) -> None:
    ids = await _seed(engine)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        memberships = await IdentityRepository().list_active_memberships(
            session, SEED_ISSUER, _seed_subject(ids["user"])
        )

    with pytest.raises(NoMembershipError):
        select_membership(memberships, tenant_hint="a-tenant-that-is-not-theirs")


class _InjectedFailure(Exception):
    """Raised deliberately after the audit append to force a rollback as a consequence."""


async def _rename_tenant_and_audit(
    session_factory: async_sessionmaker[AsyncSession],
    context: TenantContext,
    tenant_id: UUID,
    new_name: str,
    audit_action: str,
    request_id: str,
    *,
    fail_after_append: bool,
) -> None:
    """Perform one real action plus one real audit append inside one transaction.

    Mirrors app/api/v1/tenants.py's list_tenants: both writes happen through
    the actual application interfaces (tenant_scoped_transaction,
    AuditRepository.append) inside a single tenant_scoped_transaction block, so
    a fix or a regression to the real commit/rollback boundary is exactly what
    this exercises - not a hand-rolled rollback the test itself requests.
    """

    async with tenant_scoped_transaction(session_factory, context) as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        tenant.name = new_name
        await AuditRepository().append(
            session,
            context,
            AuditEvent(
                actor_type=AuditActorType.USER,
                actor_id="integration",
                action=audit_action,
                target=f"tenant:{tenant_id}",
                request_id=request_id,
                metadata={"source": "integration-test"},
            ),
        )
        if fail_after_append:
            raise _InjectedFailure


async def _read_tenant_name_and_audit_count(
    engine: AsyncEngine, tenant_id: UUID, audit_action: str
) -> tuple[str, int]:
    async with engine.connect() as connection:
        await connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, false)"),
            {"tenant_id": str(tenant_id)},
        )
        name = (
            await connection.execute(text("select name from tenants where id = :id"), {"id": str(tenant_id)})
        ).scalar_one()
        audit_rows = await connection.execute(
            text("select id from audit_log where tenant_id = :tenant_id and action = :action"),
            {"tenant_id": str(tenant_id), "action": audit_action},
        )
        return name, len(audit_rows.all())


@pytest.mark.asyncio
async def test_audit_and_action_commit_atomically(engine: AsyncEngine) -> None:
    """A committed action and its audit event must both be visible together.

    The mirror of test_audit_and_action_roll_back_together_on_failure below:
    "together" has two directions, and a bug that dropped the audit append
    while still committing the action (or vice versa) would only be caught by
    testing both.
    """

    ids = await _seed(engine)
    original_name, original_audit_count = await _read_tenant_name_and_audit_count(
        engine, ids["tenant_a"], "test.tenant.renamed"
    )
    assert original_audit_count == 0

    factory = async_sessionmaker(engine, expire_on_commit=False)
    context = TenantContext(tenant_id=ids["tenant_a"], user_id=ids["user"])
    await _rename_tenant_and_audit(
        factory,
        context,
        ids["tenant_a"],
        new_name="Renamed By Integration Test",
        audit_action="test.tenant.renamed",
        request_id="req-commit",
        fail_after_append=False,
    )

    name, audit_count = await _read_tenant_name_and_audit_count(engine, ids["tenant_a"], "test.tenant.renamed")
    assert name == "Renamed By Integration Test"
    assert name != original_name
    assert audit_count == 1


@pytest.mark.asyncio
async def test_audit_and_action_roll_back_together_on_failure(engine: AsyncEngine) -> None:
    """A failure after the audit append must roll back both the action and the audit row.

    This is the guarantee open-decisions.md names directly: "the audit event
    and the action commit or roll back together, never one without the
    other." The failure here is a consequence of _InjectedFailure raised
    *inside* tenant_scoped_transaction's `async with session.begin()` block,
    after AuditRepository.append has already flushed the audit row to the
    session - exactly the shape of a real mid-transaction failure (e.g. a
    downstream constraint violation), not a rollback the test asks for after
    the fact. If AuditRepository.append or tenant_scoped_transaction ever
    committed the audit independently of the caller's transaction - the exact
    defect this guarantee exists to catch - the audit row would survive this
    rollback and the len(...) == 0 assertion below would fail.
    """

    ids = await _seed(engine)
    original_name, original_audit_count = await _read_tenant_name_and_audit_count(
        engine, ids["tenant_a"], "test.tenant.renamed.failure"
    )
    assert original_audit_count == 0

    factory = async_sessionmaker(engine, expire_on_commit=False)
    context = TenantContext(tenant_id=ids["tenant_a"], user_id=ids["user"])
    with pytest.raises(_InjectedFailure):
        await _rename_tenant_and_audit(
            factory,
            context,
            ids["tenant_a"],
            new_name="Should Never Be Persisted",
            audit_action="test.tenant.renamed.failure",
            request_id="req-rollback",
            fail_after_append=True,
        )

    name, audit_count = await _read_tenant_name_and_audit_count(
        engine, ids["tenant_a"], "test.tenant.renamed.failure"
    )
    assert name == original_name
    assert name != "Should Never Be Persisted"
    assert audit_count == 0


@pytest.mark.asyncio
async def test_membership_resolution_works_under_non_bypass_role(postgres_url: str) -> None:
    """Prove the production auth path resolves memberships under a least-privileged role.

    This is the regression guard for the fix to the FORCE-RLS/pre-tenant-context
    gap: IdentityRepository.list_active_memberships used to query FORCE-RLS
    tables (tenant_memberships, tenants) directly before any app.tenant_id was
    set, so under a genuinely non-bypass role it returned zero rows
    unconditionally. It now calls `helm_lookup_active_memberships`, a narrow
    SECURITY DEFINER function (alembic/versions/20260805_04_membership_lookup_
    function.py) keyed on (identity_issuer, identity_subject).

    Connects as the non-bypass role (not the container's bypassing superuser)
    and asserts that IdentityRepository.list_active_memberships can resolve a
    real, active membership with no tenant context set - the same call
    app/api/deps.py::current_caller makes on every authenticated request. This
    test was previously `test_membership_resolution_under_non_bypass_role_is_a
    _known_gap`, marked xfail(strict=True); it is renamed and un-xfailed now
    that the gap is fixed, and is the only test proving the production auth
    path works under a least-privileged role.
    """

    non_bypass_engine = create_async_engine(_non_bypass_url(postgres_url), pool_pre_ping=True)
    try:
        ids = await _seed(non_bypass_engine)
        factory = async_sessionmaker(non_bypass_engine, expire_on_commit=False)
        async with factory() as session:
            memberships = await IdentityRepository().list_active_memberships(
                session, SEED_ISSUER, _seed_subject(ids["user"])
            )
        assert len(memberships) == 2
    finally:
        await non_bypass_engine.dispose()


@pytest.mark.asyncio
async def test_membership_lookup_function_never_leaks_across_identities(postgres_url: str) -> None:
    """Prove `helm_lookup_active_memberships` is a keyhole, not a door.

    A SECURITY DEFINER function is a deliberate, audited hole in RLS: it runs
    with the defining role's privileges regardless of the caller's own grants.
    That is only safe if it is narrowly parameterised and provably cannot
    return another identity's rows. This seeds two entirely separate users
    (via two independent `_seed` calls, each with its own random UUIDs and
    therefore its own distinct identity_subject), then calls the function as
    the non-bypass role with the *first* user's (issuer, subject) and asserts
    every returned membership_id belongs only to that user's own two seeded
    memberships - never the second user's, and never a row for a subject that
    was not the one passed in.
    """

    non_bypass_engine = create_async_engine(_non_bypass_url(postgres_url), pool_pre_ping=True)
    try:
        first = await _seed(non_bypass_engine)
        second = await _seed(non_bypass_engine)
        assert first["user"] != second["user"]

        factory = async_sessionmaker(non_bypass_engine, expire_on_commit=False)
        async with factory() as session:
            first_memberships = await IdentityRepository().list_active_memberships(
                session, SEED_ISSUER, _seed_subject(first["user"])
            )
        first_ids = {row.membership_id for row in first_memberships}
        assert first_ids == {first["membership_a"], first["membership_b"]}
        assert second["membership_a"] not in first_ids
        assert second["membership_b"] not in first_ids

        async with factory() as session:
            second_memberships = await IdentityRepository().list_active_memberships(
                session, SEED_ISSUER, _seed_subject(second["user"])
            )
        second_ids = {row.membership_id for row in second_memberships}
        assert second_ids == {second["membership_a"], second["membership_b"]}
        assert first["membership_a"] not in second_ids
        assert first["membership_b"] not in second_ids
    finally:
        await non_bypass_engine.dispose()


@pytest.mark.asyncio
async def test_get_tenants_endpoint_works_over_http_under_non_bypass_role(
    postgres_url: str, signing_key: SigningKey, make_token: Callable[..., str]
) -> None:
    """End-to-end proof: `GET /api/v1/tenants` succeeds under a non-bypass role.

    Every other HTTP test of this route (tests/test_tenants_endpoint.py)
    overrides `current_caller`, so it never exercises
    `IdentityRepository.list_active_memberships` at all. This test does not
    override `current_caller`: it builds the real app, wires it to the
    provisioned non-bypass-role engine, sends a genuinely signed bearer token
    (via the same `make_token`/`signing_key` fixtures conftest.py provides to
    every other JWT test), and lets the full chain run - JWT verification,
    `resolve_identity`, `list_active_memberships` (now via
    `helm_lookup_active_memberships`), `select_membership`, and the route
    body's own tenant-scoped read and audit write. This is the exact property
    that was broken: the production request path failed closed for every
    caller under a real non-bypass role.

    Uses httpx.ASGITransport rather than Starlette's TestClient because
    TestClient drives requests from a separate background-thread event loop,
    and asyncpg connections are bound to the loop that created them (see
    test_tenants_endpoint.py's `_client_for` docstring for the same
    reasoning).
    """

    non_bypass_engine = create_async_engine(_non_bypass_url(postgres_url), pool_pre_ping=True)
    try:
        ids = await _seed(non_bypass_engine)
        token = make_token(subject=_seed_subject(ids["user"]), issuer=SEED_ISSUER)

        app = create_app(Settings(helm_env=HelmEnvironment.TEST))
        app.state.session_factory = create_session_factory(non_bypass_engine)

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=signing_key.jwks)

        oidc_settings = OidcSettings(
            issuer=SEED_ISSUER,
            jwks_url="https://issuer.test/jwks",
            audience=TEST_AUDIENCE,
            allowed_algorithms=("RS256",),
            jwks_cache_seconds=300,
        )
        app.state.jwt_verifier = JwtVerifier(
            oidc_settings, httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as test_client:
            response = await test_client.get(
                "/api/v1/tenants",
                headers={"Authorization": f"Bearer {token}", "X-HELM-Active-Tenant": str(ids["tenant_a"])},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["data"][0]["id"] == str(ids["tenant_a"])
        assert body["meta"]["role"] == "owner"
    finally:
        await non_bypass_engine.dispose()

# HELM API

HELM's authoritative FastAPI control-plane foundation. Stages 1–2 provide typed configuration, safe HTTP conventions, structured logging, operational endpoints, and the Neon/Postgres tenant, membership, RLS, audit, and Alembic migration foundation. Authentication, domain APIs, queues, workers, integrations, agents, R2, and model providers are not implemented yet.

## Local setup (non-Docker)

This project requires Python 3.13 or 3.14 (`requires-python = ">=3.13,<3.15"`).
`ruff` and `mypy` deliberately target 3.13, the lower bound, so code stays
compatible with the oldest supported interpreter.

```powershell
cd api
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Copy `.env.example` to `.env` only when local overrides are needed. Never commit `.env` or secrets.

## Commands

```powershell
pytest
ruff check .
mypy app tests
```

Operational endpoints are available at `/api/v1/health`, `/api/v1/ready`, and `/api/v1/version`. The readiness endpoint explicitly reports database and queue checks as future-stage work.

## Database migrations

Alembic is the canonical — and now only — migration mechanism. It uses `DATABASE_MIGRATION_URL`, the unpooled/privileged migration URL, never the application's pooled `DATABASE_URL`. Do not run these commands against a shared or production database without an approved migration plan.

```powershell
# Set only in your uncommitted local environment, then run from api/.
$env:DATABASE_MIGRATION_URL = "postgresql+asyncpg://..."
alembic current
alembic upgrade head
```

Create future revisions only after reviewing the generated migration and ownership plan:

```powershell
alembic revision -m "describe change"
```

The prototype runner (`helm-app/db/migrations/`) and the second database it targeted have been deleted in the consolidation; see `docs/database-migration-ownership.md`.

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

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy app
```

**`pytest` alone does not run the database tests.** Two independent gates skip
them silently, and both report green: `testcontainers`/Docker being unavailable,
and `HELM_TEST_DATABASE_URL` being unset. Between them they cover RLS, the
`SECURITY DEFINER` keyholes, provisioning under a non-bypass role, and the tenant
name coming from the database rather than being fabricated from the slug. Before
this was fixed, four of those tests had never run at all.

Run the full suite with nothing skipped:

```powershell
.\.venv\Scripts\python.exe scripts\run_integration_tests.py -q
```

That starts one disposable container, migrates it, provisions the non-bypass
application role, points both switches at it, and sets
`HELM_REQUIRE_INTEGRATION_TESTS=1` so a missing prerequisite **fails** instead of
skipping. Use it before merging anything security-relevant, and in CI. Extra
arguments pass through to pytest.

Set `HELM_REQUIRE_INTEGRATION_TESTS=1` on its own wherever a green run is meant
to mean something; the session then refuses to start rather than finishing green
having collected nothing.

The red-team matrix in `tests/test_identity_integration.py` covers cross-tenant
denial, immediate membership revocation, scope denial, audit atomicity, and
membership resolution under a non-bypass role.

`HELM_TEST_DATABASE_URL` must name a **disposable** database — never a shared,
staging, or production one — and must **not** authenticate as a superuser or any
`BYPASSRLS` role. `tests/test_rls_integration.py` refuses to run against one, and
that refusal is deliberate: RLS assertions under a bypassing role prove nothing,
which is how this project's RLS chicken-and-egg bug stayed hidden twice.

### Membership resolution under a non-bypass role

`IdentityRepository.list_active_memberships` cannot be an ordinary tenant-scoped
query: it queries FORCE-RLS tables (`tenant_memberships`, `tenants`) before any
`app.tenant_id` is set, since choosing the tenant is the point of the query, and
`tenant_id = helm_tenant_id()` admits no rows while that setting is unset. It
resolves this by calling `helm_lookup_active_memberships`
(`alembic/versions/20260805_04_membership_lookup_function.py`), a narrow,
parameterised `SECURITY DEFINER` function keyed on
`(identity_issuer, identity_subject)` — adapted from the Phase A prototype's
membership-lookup precedent, but keyed on the issuer/subject pair rather than
email, since email is not an identity key. The
function is revoked from `public` and granted only to the application role, and
returns only the passed identity's own active memberships in active tenants,
deterministically ordered.

This is proven by `test_membership_resolution_works_under_non_bypass_role` in
`tests/test_identity_integration.py`, which connects as a genuinely
non-`BYPASSRLS` role — the same class of role the production database
connection uses — and by
`test_membership_lookup_function_never_leaks_across_identities`, which proves
the function cannot return one user's memberships when called with another
user's identity.

The function pins `search_path = public, pg_temp` (`pg_temp` listed
explicitly and last). Listing only `public` is insufficient and was briefly
the case here: `pg_temp` is implicitly searched *first* whenever it is not
listed, and `PUBLIC` holds `TEMP` on the database by default, so any role
able to execute the function could otherwise shadow `public.users` with a
session-local temp table and make the `SECURITY DEFINER` function return an
arbitrary victim's memberships for a fabricated identity pair.
`test_membership_lookup_function_ignores_a_shadowing_temp_table` is the
regression guard, proven to fail against the vulnerable variant and pass
against the fix. The Phase A precedent that carried the same gap has been
deleted with the prototype spine; any still-running `neondb` instance from
that era should be decommissioned (see `docs/PENDING.md`).

### Security guarantees proven

The five security guarantees have been verified against real containerised
PostgreSQL under a verified non-bypass role:

1. **Cross-tenant read denial:** A connection with tenant A's context set cannot
   see tenant B's tenants or tenant_memberships rows.
2. **Revoked and suspended membership denial:** A suspended membership stops
   resolving immediately, and an invited-but-never-accepted membership never
   gains access as if it were active.
3. **Scope denial:** A caller with a client-viewer role cannot exercise
   approval-decide scopes.
4. **Audit atomicity:** An action and its audit event commit or roll back
   together; neither can survive without the other.
5. **Membership resolution before tenant context exists:** the production auth
   path (`app/api/deps.py::current_caller`) resolves a caller's own memberships
   correctly under a non-bypass role, and only that caller's own memberships.

These proofs now cover the full production request path, including membership
resolution before any tenant context is set, under a least-privileged
(non-bypass) role.

### The OIDC issuer is deliberately not chosen

Verification is driven entirely by `OIDC_ISSUER`, `OIDC_JWKS_URL`,
`OIDC_AUDIENCE` and `OIDC_ALLOWED_ALGORITHMS`. Keycloak, a shared OIDC issuer,
or BFF-minted delegation JWTs all work without code changes, so
`docs/open-decisions.md` items 1 and 5 stay genuinely open.

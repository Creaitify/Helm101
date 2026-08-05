# HELM API

HELM's authoritative FastAPI control-plane foundation. Stages 1–2 provide typed configuration, safe HTTP conventions, structured logging, operational endpoints, and the Neon/Postgres tenant, membership, RLS, audit, and Alembic migration foundation. Authentication, domain APIs, queues, workers, integrations, agents, R2, and model providers are not implemented yet.

## Local setup (non-Docker)

This project requires Python 3.12.x.

```powershell
cd helm-api
py -3.12 -m venv .venv
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

Alembic is the canonical migration mechanism for `helm-api`. It uses `DATABASE_MIGRATION_URL`, the unpooled/privileged migration URL, never the application's pooled `DATABASE_URL`. Do not run these commands against a shared or production database without an approved migration plan.

```powershell
# Set only in your uncommitted local environment, then run from helm-api.
$env:DATABASE_MIGRATION_URL = "postgresql+asyncpg://..."
alembic current
alembic upgrade head
```

Create future revisions only after reviewing the generated migration and ownership plan:

```powershell
alembic revision -m "describe change"
```

The old `helm-app/db/migrations/` scripts are prototype-owned and must not target the same schema without an explicit, approved one-time migration plan. See `docs/database-migration-ownership.md`.

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

The red-team matrix in `tests/test_identity_integration.py` runs against a
disposable PostgreSQL container and covers cross-tenant denial, immediate
membership revocation, scope denial, and audit atomicity. It skips when Docker
is unavailable; run it with Docker started before merging security-relevant
changes.

The container integration tests require `testcontainers` (included in
`requirements-dev.txt`) and Docker to be running. They query FORCE-RLS tables
without a pre-set tenant context to verify that the database isolation holds
under a non-superuser role. To run them explicitly:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_identity_integration.py -v
```

Some tests are additionally gated on `HELM_TEST_DATABASE_URL`; never point this
at a shared, staging, or production database.

### Architectural gap: membership resolution under a non-bypass role

`IdentityRepository.list_active_memberships` queries FORCE-RLS tables
(`tenant_memberships`, `tenants`) before any `app.tenant_id` is set — a
chicken-and-egg scenario, since choosing the tenant is the point of the query.
Under a genuinely non-`BYPASSRLS` role it returns zero rows unconditionally, so
`app/api/deps.py::current_caller` — the auth path for every authenticated
request — cannot resolve memberships. Every environment tested so far connects
as a superuser, which implicitly bypasses RLS regardless of table policies and
masks this defect.

This is pinned by `test_membership_resolution_under_non_bypass_role_is_a_known_gap`
(xfail, `strict=True`) in `tests/test_identity_integration.py`. When fixed, this
test must pass. The precedent for the fix is `helm-app/db/migrations/0008_membership_lookup_all.sql`,
which creates a narrow, parameterised `SECURITY DEFINER` function. **This gap must be resolved before Stage 1 is production-ready.**

### Security guarantees proven

The four security guarantees have been verified against real containerised
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

These proofs cover the security model when the connection is already scoped to a
tenant. They do *not* yet cover the production request path under a
least-privileged (non-bypass) role, which is blocked by the architectural gap above.

### The OIDC issuer is deliberately not chosen

Verification is driven entirely by `OIDC_ISSUER`, `OIDC_JWKS_URL`,
`OIDC_AUDIENCE` and `OIDC_ALLOWED_ALGORITHMS`. Keycloak, a shared OIDC issuer,
or BFF-minted delegation JWTs all work without code changes, so
`docs/open-decisions.md` items 1 and 5 stay genuinely open.

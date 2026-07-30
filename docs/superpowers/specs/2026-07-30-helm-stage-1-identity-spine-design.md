# HELM Stage 1 — Identity, Tenancy and Transaction Security Spine

**Date:** 2026-07-30
**Status:** Approved for planning
**Sub-project:** 1 of the FastAPI backend track (Option B)

## Context and decision

HELM has two backends built to conflicting designs. `helm-app` (Next.js) completed
"Phase A": a working, tenant-isolated Neon spine with 190 passing tests, where server
actions query Postgres directly. `helm-api` (FastAPI) has only a foundation: health
endpoint, ORM models, one migration, no business API.

The Stage 0 documents are unambiguous that FastAPI is the intended system of record.
`backend-fastapi_llm-architecture.md` §"Existing-project implications" states the
`helm-app` database and server code "must not be treated as production backend
implementation". `backend-bff-contract.md` states the BFF "must not query Neon
directly" — which is precisely what Phase A does.

**The decision is Option B:** build FastAPI as the real backend and treat Phase A as a
prototype. This spec covers only the first sub-project.

### Accepted cost

Stage 1 rebuilds capability Phase A already has. It ends roughly where Phase A already
is, on a different foundation. This is a deliberate, accepted trade: Phase A's
architecture cannot host the workers, durable agents, model gateway, and MCP
integrations the target architecture requires. The payoff is everything after Stage 1,
not Stage 1 itself.

## Scope decomposition

Option B in full spans five or six independent subsystems. `open-decisions.md`
already prescribes the order:

> Begin with the identity, tenancy, and transaction-security foundation in FastAPI...
> Do not start campaigns, gateway adapters, agents, integrations, or BFF endpoints
> until these primitives have security tests for cross-tenant denial, revoked/suspended
> membership, scope denial, and audit atomicity.

Sub-projects, in order:

1. **Identity + authorization spine** — this spec
2. First domain resource end-to-end (campaigns read, approvals decide)
3. BFF cutover — `helm-app` stops querying Neon, calls FastAPI
4. Async spine (outbox, queue, workers)
5. Model gateway
6. Agents and MCP integrations

## Resolved blockers

Three questions blocked Stage 1. All are now decided.

### 1. The auth-contract implementation freeze

`auth-contract.md` says: "Do not implement HELM authentication until senior/backend and
frontend owners confirm one of these production designs." That decision
(`open-decisions.md` items 1 and 5) is still open.

**Resolution: build provider-agnostic, defer the issuer.** The same document states
FastAPI verification "is provider-agnostic and configuration-driven through
`OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_AUDIENCE`, and `OIDC_ALLOWED_ALGORITHMS`" and
"can change without FastAPI code changes if it provides standards-compliant OIDC
discovery/JWKS and the configured claims contract."

Stage 1 therefore implements verification against that configuration contract and
nothing else. The verifier never learns who the issuer is. Tests generate a local RSA
keypair and serve their own JWKS. Keycloak, a shared OIDC issuer, or BFF-minted
delegation JWTs all plug in later as configuration. This respects the freeze's intent
— no premature commitment to an issuer — without stalling the phase.

### 2. Role vocabulary conflict

The Phase A database has six roles (`owner`, `agency_admin`, `strategist`, `creative`,
`analyst`, `client_viewer`). The FastAPI `tenant_membership_role` enum has three
(`owner`, `agency_admin`, `client_viewer`).

**Resolution: expand FastAPI to all six.** The UI already renders strategist, creative,
and analyst surfaces and Phase A seeded them. Widening the enum keeps those screens
meaningful and avoids a second migration during sub-project 2.

### 3. Schema ownership collision

`helm-app/db/migrations` (0001–0008) and Alembic would otherwise fight over one
database.

**Resolution: a separate Neon branch/database for FastAPI.** Alembic owns it outright.
`helm-app` keeps its own database and migrations, untouched. Two connection strings, no
collision, both systems stay runnable until the sub-project 3 cutover retires Phase A's.
This also makes migration ownership unambiguous, satisfying
`database-migration-ownership.md`.

## Architecture

The authenticated request path, end to end:

```
Bearer JWT
  → verify signature and claims against cached JWKS
  → resolve global user by (identity_issuer, identity_subject)
  → resolve active membership for the requested tenant
  → compute effective scopes (role defaults ± grants/restrictions)
  → open transaction, SET LOCAL app.tenant_id
  → enforce endpoint scope
  → perform work, append audit event
  → commit
```

### Modules

Five new modules under `app/`, each independently testable with a single purpose.

| Module | Purpose | Depends on |
|---|---|---|
| `auth/jwt_verifier.py` | JWKS fetch and cache; validate signature, `iss`, `aud`, `exp`, `nbf`, `iat`, algorithm allow-list. Returns a verified subject or raises. | config |
| `auth/identity.py` | Verified subject → global `User`. Keys on `(identity_issuer, identity_subject)`, never email. | jwt_verifier, repositories |
| `auth/membership.py` | User + tenant hint → active `TenantMembership`, or `tenant_context_required`. | repositories |
| `auth/scopes.py` | Role → default scopes; applies grants and restrictions. Pure functions, no I/O. | nothing |
| `api/deps.py` | FastAPI dependencies composing the above into a `RequestContext`. | all of the above |

`scopes.py` is deliberately pure and I/O-free. Authorization logic is the easiest thing
to get wrong and the cheapest thing to test exhaustively when it has no dependencies.

`identity.py` keying on `(identity_issuer, identity_subject)` rather than email is a
requirement from `auth-contract.md`: "email is not an identity key". Email is retained
for provisioning correlation only.

### Scope derivation

Effective scopes are computed server-side from the membership row. Per
`backend-fastapi_llm-architecture.md`, "effective scopes can only narrow role defaults
unless an explicit, audited grant policy is approved". Stage 1 implements exactly that:
restrictions always subtract; grants are applied but constrained to the role's
permitted superset, so a grant cannot escalate beyond the role.

Incoming tokens never carry roles, scopes, or tenant ids as authoritative data.
`X-HELM-Active-Tenant` is a selection hint only, validated against real membership.

## Data model changes

One Alembic migration, `20260730_02_identity_spine`:

1. **Widen `tenant_membership_role`** — add `strategist`, `creative`, `analyst`.
   `ALTER TYPE ... ADD VALUE` is additive and safe on existing rows.
2. **`idempotency_keys` table** — tenant-scoped, RLS enabled and forced, unique on
   `(tenant_id, key)`, storing request fingerprint and stored response for mutation
   replay safety.

The identity and membership uniqueness constraints this phase depends on already exist
in `20260727_01_foundation.py` — `uq_users_identity_issuer_subject` and
`uq_tenant_memberships_tenant_user`. No migration work is needed for either; Stage 1
relies on them and adds a test asserting both still hold.

Every tenant-owned table follows the existing 0001 pattern: `tenant_id` foreign key,
RLS enabled **and** forced, isolation policy via `helm_tenant_id()`.

## Error handling

RFC 9457 Problem Details already exist in `core/errors.py`. Stage 1 adds the auth codes
named in `backend-bff-contract.md`:

| Status | Code | Condition |
|---|---|---|
| 401 | `invalid_token` | Missing, expired, bad signature, or wrong audience |
| 403 | `insufficient_scope` | Valid identity, lacks the required scope |
| 403 | `no_membership` | Valid identity, no active membership in that tenant |
| 400 | `tenant_context_required` | No tenant selected and no safe default |

**No error distinguishes "tenant does not exist" from "you have no membership there".**
Both return an identical response, so the API cannot be used to enumerate tenants. No
error reveals secrets, cross-tenant resource existence, policy internals, or raw
provider errors.

Suspended or revoked membership blocks access immediately, regardless of an unexpired
token, because membership is resolved per request rather than trusted from the token.

## Testing

Three layers.

**Unit.** `scopes.py` exhaustively: all six roles across grant and restriction
combinations, including the case where a grant attempts to exceed its role's superset.
`jwt_verifier.py` against a locally generated RSA keypair, covering the full rejection
matrix: expired, not-yet-valid, wrong audience, wrong issuer, unsigned, `alg: none`,
tampered payload, and unknown `kid`. The `alg: none` and unknown-`kid` cases are called
out explicitly because they are the classic JWT bypasses; a verifier accepting either
is worse than no verifier at all.

**Integration, on real Postgres via testcontainers.** The red-team matrix
`open-decisions.md` requires:

- cross-tenant read denial under RLS
- revoked and suspended membership denial
- scope denial
- audit atomicity — the audit event and the action commit or roll back together, never
  one without the other

These use a disposable containerised Postgres, never a shared, staging, or production
database. They skip cleanly when Docker is unavailable, matching the existing
`test_rls_integration.py` behaviour, so the suite stays green on machines without a
running daemon.

**API.** `GET /api/v1/tenants` exercised through the whole chain: a forged token, a
valid token with no membership, and a valid token with an active membership.

## Out of scope

Deliberately excluded from Stage 1:

- Campaigns, approvals, or any domain resource
- Queue, outbox, or workers
- Model gateway and provider adapters
- MCP services and integrations
- Any change to `helm-app`, which keeps running on Phase A untouched
- Keycloak or Docker OIDC provisioning (deferred by team decision)
- Vault/KMS (`open-decisions.md` item 4)

## Definition of done

`GET /api/v1/tenants` returns the caller's real memberships from a real database,
authenticated by a genuinely verified JWT, scoped by RLS, with an audit event written —
and the full security test matrix passes against live containerised Postgres.

Gates: `pytest`, `ruff check`, and `mypy --strict` all clean.

## Open item for the user

**Python version is inconsistent and currently unsatisfiable.** `pyproject.toml` pins
`requires-python = ">=3.12,<3.13"`, `ruff target-version = "py312"`, and
`mypy python_version = "3.12"`; `.python-version` says `3.12.10`. No Python 3.12 is
installed on the development machine — only 3.13.14 and 3.14 — so the working venv is
3.13 and violates the project's own pin. Tests, ruff, and mypy currently pass anyway.

There is no CI yet, so nothing enforces the discrepancy today, but it will surface the
moment CI is added. Two options, to be chosen before Stage 1 completes:

- Install Python 3.12 and match the declared pins, or
- Raise the pins to 3.13 in all four locations.

This spec does not assume either.

# HELM — what is built, what is pending

Last updated: 2026-08-12. Reflects the consolidation cleanup (branch `anzar`):
Phase A deleted, monorepo reshape (`api/`, `web/`, `workers/`), demo-mode data
seam. Governed by the technical blueprint (HELM_Technical_Blueprint.pdf) and
`HELM_ARCHITECTURE.md`: **consolidate and extend, not rewrite.**

> **Read this first:** an independent post-cleanup audit
> (`docs/reports/HELM_POST_CLEANUP_AUDIT_2026-08-12.md`) verified the current
> state, corrected several status claims in this file, and lays out the
> evidence-based resume plan (Phase 0 closure → Phases 1–2 before anything
> else). Where this file and the audit disagree, trust the audit.

This is the honest state of the platform: what actually works, what is blocked
and on whom, and what remains unbuilt. Where something is deferred it says why.

---

## What the consolidation changed (2026-08-11)

The blueprint's drop-list, executed:

- **Phase A is gone.** `lib/repositories/`, `lib/server/{tenant-session,db,
  tenant-context,audit,platform-read}.ts`, `db/migrations/` (SQL 0001–0008),
  the `db:*` scripts, and the email-keyed identity path — deleted (~4,000 lines
  incl. tests). One identity model remains: `(issuer, subject)` in FastAPI.
  One database remains: the Alembic-owned schema. One scope vocabulary remains:
  the API's.
- **The prototype gateway stub is gone** (`lib/gateway/`, `usage.ts`). The real
  gateway is sub-project 3, inside FastAPI.
- **The fixture-fallback ladder is gone.** `lib/data` serves fixtures
  explicitly; demo mode is a first-class flag (`HELM_DEMO_MODE`, default: demo
  exactly when `HELM_API_BASE_URL` is unset). Production code never silently
  falls back to fixtures again.
- **The app shell cut over to the API.** `app/(app)/layout.tsx` resolves the
  tenant through `GET /api/v1/tenants` (via `lib/server/shell-data.ts`), with
  the `helm_active_tenant` cookie as a non-authoritative `X-HELM-Active-Tenant`
  hint and stale-hint retry. The tenant switcher is now "pick among your own
  tenants" — platform-admin impersonation went with Phase A.
- **Monorepo reshape**: `helm-api → api/`, `helm-app → web/`, plus a `workers/`
  scaffold documenting what lands there (queue consumers, generation jobs,
  LangGraph runtime).
- **Docs consolidated.** Completed superpowers plans/specs and mockups v1/v3
  deleted (git history on `main` is the archive); `followups.md` folded into
  the backlog below; `helm-mockup-v4.html` stays as the pixel source of truth.

What deliberately did **not** change: the auth spine (Auth0 + NextAuth BFF +
FastAPI verification chain), every UI surface's rendering, `app/globals.css`,
and all of `api/` except one empty package and path references.

---

## What is verified running locally

Re-run on 2026-08-11 after the cleanup:

| Gate | Result |
|---|---|
| `web` vitest | 207 passed / 43 files |
| `web` `tsc --noEmit`, ESLint, `next build` | clean |
| `api` pytest (no Docker) | 139 passed, 29 skipped (all Docker/DB-gated) |
| `api` integration runner | not re-run this session (Docker unavailable); last full run 2026-08-09: 168 passed, 0 skipped |

The vitest delta from the previous record (317/53) is the deleted Phase A test
files plus the new seam tests (`shell-data`, `data-demo`, `app-layout`, and
rewritten `tenant-directory`/`tenant-switch-route`/`approvals-action`/
`role-mapping`).

Both services start and serve **without** any Auth0 or database credential —
`web` renders every surface in demo mode. Credentials unlock sign-in and real
tenant data, not the ability to run the platform.

---

## Remaining local blockers — three inputs, all yours

| Input | Fills |
|---|---|
| Auth0 tenant domain | `AUTH0_ISSUER` (no trailing slash), `OIDC_ISSUER` (trailing slash **required**), `OIDC_JWKS_URL` |
| Auth0 client id + secret | `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` |
| Neon connection string | `DATABASE_URL`, as `helm_app` — never a `BYPASSRLS` role |

---

## The one thing blocking live sign-in

**Create the `helm-api` API in the Auth0 tenant `dev-0z3nrg8oz43x8zsc`.**

Auth0 dashboard → **Applications → APIs → Create API** (the APIs section, not
Applications → Applications):

| Field | Value |
|---|---|
| Name | `HELM API` |
| Identifier | `helm-api` (the literal string — not a URL, cannot be changed later) |
| Signing algorithm | RS256 |

Without it, Auth0 rejects the password grant for "invalid audience" and the
user sees *"incorrect email or password"* for a password that was never
checked. Verify with:

```bash
cd api && ./.venv/Scripts/python.exe -m app.cli.preflight --live
```

Already verified working: tenant reachable, password grant enabled, signup
creates real accounts.

---

## Build plan — phases and gates (from the blueprint)

Each phase ends with a CI-enforceable gate. Hardening items fold into the
phase where they become load-bearing.

| Phase | Deliverable | Gate |
|---|---|---|
| **0. Foundation** | Consolidated repo (`api/ web/ workers/ docs/`), Phase A deleted, demo seam | ⚠️ partial — repo shape and web suites are green, but the blueprint's Phase 0 gate also requires CI, Sentry, a staging deployment, and a locally verified API suite (the stale `api/.venv` blocks pytest). See the audit, §5 |
| **1. Close the auth gap** | BFF workload assertion verified by FastAPI; rate limiting | a direct-to-API call without the assertion fails in staging |
| **2. Domain cutover** | campaigns / approvals / directory / integrations as real FastAPI endpoints; `lib/data` getters swap fixture → API at their `TODO(phase-2)` markers | UI reads only through the API client; demo mode still fully renders |
| **3. Model gateway** | `gateway/{contracts,adapters/anthropic,ledger,service,keys}.py` in FastAPI; Langfuse tracing; routing table | the N-vs-cap concurrency test passes; 402 surfaces cleanly |
| **4. Studio generation** | brief → Claude variants → compliance verdict → human gate → persisted, audited, billed | the slice definition of done below; eval gate green |
| **5. Async spine + creative** | Postgres queue (SKIP LOCKED), outbox, workers, DLQ; R2 signed URLs; image/video as async jobs | job survives worker restart; DLQ re-drive works |
| **6. Agents + MCP** | LangGraph runtime (Postgres checkpointer); Analyst agent first (read-only); MCP read-first | proposal appears in inbox and resumes on decision; kill switch freezes autonomy |
| **7. Scale & sovereignty** | local inference adapter (vLLM), hosted fine-tunes, Redis graduation — **trigger-driven only** | same eval suite passes on the new route; rollback demonstrated |

### Definition of done for the current slice

A real person signs in through Auth0, lands in their tenant, writes a brief in
Studio, and sees copy variants generated by Claude — persisted,
compliance-checked, tenant-isolated, audited, and billed against a real budget
ledger.

---

## Next: close Phase 0, then Phases 1–2 — the gateway comes after

The audit's corrected sequencing: finish the Phase 0 gate (CI with
fail-not-skip integration tests, Sentry, staging, reproducible setup, verified
API suite), then close the auth/tenancy boundary (Phase 1) and restore real
domain endpoints (Phase 2). Gateway *design* can proceed in parallel, but no
Phase 3 code ships before the earlier gates are green.

### Reference: the model gateway (sub-project 3 / Phase 3)

| Module | Purpose |
|---|---|
| `gateway/contracts.py` | Provider-neutral request/response/usage types. Pure, no I/O |
| `gateway/adapters/anthropic.py` | Contract → SDK → contract. The only file naming a vendor |
| `gateway/ledger.py` | Budget reservation, spend recording, cap enforcement |
| `gateway/service.py` | Composes: resolve policy → reserve → call → record |
| `gateway/keys.py` | Single accessor for provider credentials |

**The budget ledger is the hard part.** Reserve-before, reconcile-after, with
the cap check and reservation in one transaction. The test that matters: *N
simultaneous requests against a cap permitting fewer than N must yield exactly
the permitted number of successes.* Exhaustion returns `budget_exceeded` /
HTTP 402. **Provider fallback is deliberately absent** until the
data-residency decision exists. No Anthropic key is needed to build it —
adapters run against recorded fixtures.

Framework decisions (blueprint §5): Studio generation and workspace chat use
the **direct Anthropic SDK** (no framework); RAG is owned pgvector code;
**LangGraph without LangChain** for agents (Phase 6); Langfuse self-hosted for
LLM observability.

---

## Deferred, with reasons

| Item | Why deferred |
|---|---|
| **Domain endpoints** (campaigns, approvals, directory, integrations) | Phase 2. Until then every surface serves fixtures; approvals' approve/reject is a validated no-op acknowledgment |
| **Async spine** (queue, outbox, workers, DLQ) | Phase 5; open decision #3 |
| **Image and video generation** | Needs the async spine + R2. #10 |
| **LangGraph agent runtime** | Phase 6. #6 |
| **Embedded LLM workspace** | Needs streaming through FastAPI + conversation persistence |
| **Invitation lifecycle** | #8. `app.cli.provision` is the only entry path |
| **Vault/KMS** | #4. Provider keys stay in env vars behind a single accessor |
| **Refresh-token rotation** | Needs Vault/KMS first. Auth0 access tokens last 24h; a stale one surfaces as a clean 401 |
| **BFF workload assertion** | Phase 1. Today the BFF sends only the bearer token |
| **Cross-tenant platform-admin reads** | Went with Phase A's `platform-read.ts`; returns as real platform-scoped FastAPI endpoints when needed |

---

## Known issues and technical debt

### Resolved by the consolidation (2026-08-11)

- ~~Two identity models~~ — Phase A's email-keyed path is deleted.
- ~~Two databases / two migration runners~~ — Alembic is the only runner.
- ~~Two scope vocabularies~~ — only the API's remains.
- ~~`tenant-directory.ts` untyped auth error~~ — now a typed
  `UnauthenticatedError`.
- ~~Phase A `helm_lookup_membership` pg_temp exposure~~ — the vulnerable
  migrations no longer exist in the repo. **Operational leftover:** any still-running
  prototype `neondb` instance predating migrations 0007/0008 carries the
  vulnerable function — decommission it (nothing reads it anymore).

### Open

- **`GET /api/v1/tenants` discovery chicken-and-egg.** A multi-membership
  caller with no `X-HELM-Active-Tenant` hint gets `tenant_context_required` —
  you cannot list tenants to pick one without naming one. The layout routes
  this to `/no-access` with a `TODO(phase-2)`; the API should exempt the
  discovery endpoint from requiring context.
- **The tenants endpoint returns only the active tenant**, so the switcher can
  never show multiple tenants in live mode until the endpoint returns all of
  the caller's memberships (Phase 1–2 change).
- **`Tenant.region`/`env` in the shell are placeholders** in live mode
  (`'cloud'` / `HELM_ENV`) — the API doesn't model them yet.
- **No CI configuration.** When added, it must set
  `HELM_REQUIRE_INTEGRATION_TESTS=1` or the DB tests skip silently and report
  green. The eval regression gate (Phase 4) belongs in the same pipeline.
- **`npm audit` advisories** in `web` — re-check after the dependency pruning
  (`@neondatabase/serverless`, `tsx`, `playwright` removed); triage what
  remains.
- **`api/.venv` is stale** — it predates the folder rename and points at a
  Python 3.12 installation that no longer exists, so pytest cannot start.
  Recreate it with `py -3.13 -m venv .venv` (the project requires
  `>=3.13,<3.14` per `api/pyproject.toml`) and reinstall requirements.

### UI backlog (from the retired followups.md — all pure frontend, unblocked)

- Approvals: real Edit affordance (open payload in a SlideOver before approve).
- Studio: acknowledge-to-ship for SEBI-flagged variants.
- Workspace: token-by-token reply reveal; file-attach chip.
- Campaigns: sortable columns; wire the drawer chart to `detail.series`.
- Analytics: move inline presentational datasets (heatmap seed, gauge targets,
  leaderboard rows) into `lib/data`.
- Mobile: sidebar drawer under ~820px; `DataTable` `any` types.

---

## Running the tests properly

```bash
cd web && npm test && npx tsc --noEmit && npm run lint
cd api && ./.venv/Scripts/python.exe -m pytest -q
```

**`pytest` alone does not run the database tests** — Docker being unavailable
and `HELM_TEST_DATABASE_URL` being unset both skip them silently. Run the full
suite with nothing skipped:

```bash
cd api && ./.venv/Scripts/python.exe scripts/run_integration_tests.py -q
```

Docker Desktop must actually be **running**. `HELM_TEST_DATABASE_URL` must
name a disposable database and must **not** be a superuser/`BYPASSRLS` role —
`tests/test_rls_integration.py` refuses otherwise, deliberately.

See `docs/conventions/test-vacuity.md` — ten patterns of tests that pass for
the wrong reason, every one found in this repository.

---

## Local setup

```bash
cd api && py -3.13 -m venv .venv \
  && ./.venv/Scripts/python.exe -m pip install -r requirements.txt -r requirements-dev.txt
cd web && npm install
```

**Demo mode (zero setup):** `cd web && npm run dev` with an empty `.env.local`
renders every surface from fixtures.

**Live mode:**

1. `docs/runbooks/auth0-setup.md` — the Auth0 dashboard steps.
2. Copy `web/.env.example → web/.env.local` and `api/.env.example → api/.env`.
   Generate `AUTH_SECRET`/`ENCRYPTION_KEY` with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. `cd api && ./.venv/Scripts/python.exe -m app.cli.preflight --live`
4. `cd api && ./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`
5. `cd web && npm run dev`

**The trailing-slash asymmetry is deliberate.** `AUTH0_ISSUER` takes **no**
trailing slash; `OIDC_ISSUER` **requires** one. Getting it wrong produces a
token that verifies cryptographically and is then rejected for wrong issuer.

`DATABASE_URL` must authenticate as `helm_app` (no `BYPASSRLS`), scheme
`postgresql+asyncpg://`, and **no** `?sslmode=`/`channel_binding=` query
string (libpq options that asyncpg rejects).

---

## After sign-in works

1. Get your Auth0 `sub` from User Management → Users → your user → `user_id`.
2. Provision yourself:

```bash
cd api && ./.venv/Scripts/python.exe -m app.cli.provision \
  --issuer "https://dev-0z3nrg8oz43x8zsc.eu.auth0.com/" \
  --subject "auth0|YOUR-SUBJECT" \
  --email "you@example.com" \
  --tenant "letstute" \
  --role owner
```

`--issuer` must match `OIDC_ISSUER` exactly, trailing slash included.

3. Set `HELM_DEMO_MODE=false` (or just set `HELM_API_BASE_URL`) and verify the
   shell resolves your real tenant. Then **stop FastAPI and reload**: you must
   see an error state, not an empty tenant list — an outage must never look
   like revoked access.

---

## Decision register

Closed: **#1/#5** (hosted OIDC issuer: Auth0) · **repo shape** (monorepo
`api/ web/ workers/ docs/` — executed 2026-08-11).

Recommended by the blueprint (§12), awaiting a one-line sign-off each:
hosting (Vercel + Railway/Fly.io) · queue (Postgres SKIP LOCKED, no Redis at
launch) · agent language (Python — reverses the original TS-first note) ·
AI budget rate card · observability stack (Langfuse self-hosted + Grafana +
Sentry).

Still open: **2, 3, 4, 6, 7, 8, 9, 10** — see `docs/open-decisions.md`. Real
PII ingestion and non-proposed autonomous actions stay off until residency,
autonomy policy, and R2 region are signed off — a business gate, not an
engineering one.

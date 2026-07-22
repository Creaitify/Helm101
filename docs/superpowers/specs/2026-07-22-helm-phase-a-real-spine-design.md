# HELM Phase A — Real Spine (Auth + Data)

**Date:** 2026-07-22
**Status:** Approved design
**Sub-project:** Phase A of 6 (see "Programme decomposition" below)

---

## 1. Context

HELM today is a complete UI prototype. Eleven screens, ~25 components, 22 test files and 47
passing tests render entirely from hardcoded fixtures in `lib/data/mock/fixtures.ts`. A thin
foundations layer exists alongside it — two Neon migrations with real RLS policies, a
tenant-context transaction helper, an append-only audit helper, an Auth.js configuration and a
Model Gateway class — but no screen touches any of it.

The seam is explicit. `lib/data/index.ts:4` reads:

```ts
const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for fetch() later
```

Phase A takes that seam and puts a real database behind it.

### 1.1 Programme decomposition

The full specification in `HELM_ARCHITECTURE.md` is a multi-month programme. It is sequenced as
six sub-projects, each ending with a running, demoable application:

| Phase | Scope |
|---|---|
| **A — Real spine** | Auth, route protection, migration 0003, repositories, mock→DB cutover |
| **B — Live gateway** | Provider adapters, metering, budgets, kill switch, real Workspace chat |
| **C — Data & analytics** | Event ingestion, identity resolution, attribution, funnel rollups |
| **D — MCP integration layer** | Credential vault, OAuth flows, read-only then write connectors |
| **E — Agent runtime** | Durable LangGraph service, checkpointer, HITL interrupts, policy engine |
| **F — Creative + hardening** | Job queue, Veo 3.1, Nano Banana, R2, Cloudflare, load + security review |

Two deviations from the epic ordering in `HELM_ARCHITECTURE.md` §16 are deliberate. The creative
subsystem moves last, because it carries the most infrastructure per unit of visible progress and
nothing else depends on it. Epic 8 (custom algorithms) is dropped from the sequence entirely,
because it is premature until Phase C produces real training data. The monorepo scaffold from
Epic 1 is also skipped: the existing single Next.js app works, and restructuring buys nothing
until Phase E needs a separately deployable service.

**This document specifies Phase A only.**

### 1.2 Available infrastructure

A Neon project, an OAuth application (Google and/or Microsoft Entra) and model provider API keys
are all provisioned. Phase A uses the first two. Model keys are Phase B.

---

## 2. Goals

1. No page is reachable without authentication.
2. Every screen reads tenant-scoped rows from Neon under row-level security.
3. Approving, rejecting and editing write real rows and real audit events.
4. The Master Admin can operate across tenants through an audited, read-only path.
5. The existing 47 tests stay green throughout.

### 2.1 Non-goals

No model provider calls (Phase B). No event ingestion or attribution (Phase C). No MCP connectors
or credential vault (Phase D). No agent runtime (Phase E). No creative generation, R2 or
Cloudflare (Phase F). Integration toggles remain cosmetic until Phase D.

---

## 3. Architecture

### 3.1 The two seams

Phase A replaces what sits behind two files without changing either file's public shape:

- `lib/data/index.ts` — every screen's server-side read.
- `lib/tenant.tsx` — the client-side tenant and role context, currently a module constant
  hardcoded to `finnovate` / `master`.

Preserving both signatures is what keeps every screen rendering and every existing test green.

### 3.2 Layering

```
Server Component (app/(app)/*/page.tsx)   — unchanged
  └─ lib/data/index.ts                    — same signatures, new body
      └─ lib/repositories/*.ts            — NEW: one module per aggregate
          └─ withTenantContext(ctx, tx => …)
              └─ Neon + RLS (app.tenant_id set transaction-locally)
```

Repositories are the new unit of isolation. One module per aggregate — `campaigns.ts`,
`approvals.ts`, `creatives.ts`, `conversations.ts`, `users.ts`, `integrations.ts`. Each accepts a
`TenantTransaction` and returns UI-shaped domain types from `lib/types.ts`. A repository never
opens a connection and never sees a session. That boundary is what makes them testable in
isolation, and what makes it impossible for a caller to forget tenant scoping.

### 3.3 Required change to existing code

`TenantTransaction.execute` returns `Promise<void>`, so the data layer can currently only write.
Phase A adds a sibling method rather than changing the existing signature:

```ts
export interface TenantTransaction {
  execute(query: string, values?: readonly unknown[]): Promise<void>
}

/** A transaction that can also read. Repositories require this; writers accept either. */
export interface TenantQueryTransaction extends TenantTransaction {
  query<T>(statement: string, values?: readonly unknown[]): Promise<T[]>
}
```

`query` is added on a **new extending interface**, not on `TenantTransaction` itself. This is
load-bearing: adding a required method to the existing interface would break every current
implementer, including the `tx` object literal in `withTenantContext` and any test fake — which
would contradict the "47 tests stay green" contract in §9. Widening by extension keeps
`appendAuditEvent` and `establishTenantContext`, which accept `TenantTransaction`, compiling and
passing unchanged, while repositories declare the narrower `TenantQueryTransaction` they need.

`withTenantContext` in `lib/server/db.ts` implements `query` on the same client inside the same
transaction, so RLS context applies to reads identically to writes, and its callback type widens
to `TenantQueryTransaction`.

### 3.4 Session to tenant context

```
OAuth callback
  → users lookup by email
  → membership {tenantId, userId, role}
  → JWT carries {userId, tenantId, role, scopes, isPlatformAdmin, activeTenantId?}
  → requireTenantContext() on every server read
  → set_config('app.tenant_id', $1, true) inside the transaction
```

A tenant id is never accepted from browser input. It derives from the session only, matching the
existing `createTenantContext` contract in `lib/server/tenant-context.ts`.

### 3.5 Role vocabulary

The database enum is canonical. The UI vocabulary in `lib/types.ts` is unchanged, and a single
mapping module at the session boundary converts between them:

| DB (`helm_role`, canonical) | UI (`Role`) |
|---|---|
| `owner` | `master` |
| `agency_admin` | `agency` |
| `strategist` | `strategist` |
| `creative` | `creative` |
| `analyst` | `analyst` |
| `client_viewer` | `viewer` |

The mapping lives in `lib/server/role-mapping.ts` and is exhaustive in both directions, so adding
an enum value fails to compile until the mapping is updated. No screen, no RBAC matrix entry and
no existing test changes.

### 3.6 Platform-admin cross-tenant access

The Master Admin sits above every tenant, but `users` is tenant-scoped and its RLS policy fails
closed. Cross-tenant visibility therefore requires an explicit, contained privileged path:

- `platform_admins` lives outside tenant scope — no `tenant_id` column, no RLS.
- A separate Neon role `helm_platform_reader` holds `bypassrls` and `SELECT`-only grants, reached
  over a **separate connection string** (`NEON_PLATFORM_READER_URL`). The application's normal
  pool never holds bypass capability.
- Exactly one function, `withPlatformReadContext()`, may use it. It rejects any statement that is
  not a `select`, and writes an `audit_log` event for every invocation.
- Ordinary master-admin browsing does **not** use this path. It uses the tenant switcher and runs
  under normal RLS for one tenant at a time. The bypass exists only for genuine cross-tenant
  aggregates, keeping the privileged path rarely exercised and easy to review.

---

## 4. Data model — migration `0003_operate_core.sql`

Every tenant-owned table repeats the pattern established in `0001_foundations.sql`:
`tenant_id uuid not null references tenants(id)`, row-level security both `enable`d and
`force`d, and an isolation policy using `helm_tenant_id()`. `force` is required — without it the
table owner silently bypasses the policy.

New enum types follow the `helm_role` / `integration_status` precedent from 0001:
`campaign_status`, `creative_kind`, `creative_status`, `compliance_verdict`, `approval_status`.

### 4.1 Tables

**`campaigns`** — backs the Campaigns list and detail drawer.
`id, tenant_id, name, channel, status, objective, spend_minor, budget_minor, results,
cac_minor, roas, started_at, created_at, updated_at`.

**`ad_groups`** — `id, tenant_id, campaign_id, name, status, spend_minor, results`. Carries
`tenant_id` despite being a child of `campaigns`, so RLS applies directly rather than through a
join.

**`campaign_metrics`** — `id, tenant_id, campaign_id, metric_date, spend_minor, results`. One row
per campaign per day. Drives the drawer's 14-point `series`, which the current implementation
returns but ignores (followup #6). Phase C's rollups build on this table.

**`creatives`** — `id, tenant_id, campaign_id (nullable), kind, label, status, headline, body,
compliance, compliance_reason, created_at`. Serves both the Campaigns drawer and Creative Studio:
`Variant` and `CreativeAsset` are two projections of one row.

**`approvals`** — `id, tenant_id, agent_code, action, summary, payload jsonb, checks jsonb,
status, proposed_at, decided_at, decided_by`. Decisions never delete; they transition `status` and
append an audit event. Phase E's HITL interrupts resume against this table.

**`conversations`** — `id, tenant_id, user_id, title, created_at`.

**`messages`** — `id, tenant_id, conversation_id, role, text, citations jsonb, created_at`. Beyond
seed data these stay empty until Phase B fills them with real gateway traffic.

**`prompt_templates`** — `id, tenant_id, title, body, created_at`. Tenant-scoped, so tenants
cannot see each other's prompt library.

**`platform_admins`** — `user_id uuid primary key, granted_at, granted_by`. No `tenant_id` and no
RLS, deliberately outside tenancy. This is precisely why it is reachable only through the audited
read-only path in §3.6.

### 4.2 Money

All monetary columns are integer minor units (paise), suffixed `_minor`. Never floating point.
Display formatting is already handled by `lib/format.ts`.

### 4.3 `updated_at`

Set explicitly in repository writes. Migration 0001 declares `updated_at` columns without trigger
maintenance; Phase A follows that precedent rather than introducing trigger machinery it does not
need.

### 4.4 Indexes

`(tenant_id, status)` on `campaigns` and `approvals` — the two filtered lists.
`(campaign_id, metric_date)` on `campaign_metrics`.
`(conversation_id, created_at)` on `messages`.

### 4.5 Deferred by design

No `leads`, `events` or `attribution` tables (Phase C). No `credentials` vault (Phase D). No
`agent_runs` or checkpointer tables (Phase E). Migration 0003 covers only what a screen renders
today.

---

## 5. Authentication and route protection

**Login.** A `/login` page outside the `(app)` route group, offering Google and Microsoft Entra.

**Middleware.** `middleware.ts` protects every route except `/login`, `/api/auth/*` and
`/api/health`. Unauthenticated requests redirect to `/login`. `/` redirects to `/analytics` once
authenticated.

**Provisioning.** The OAuth callback looks up `users` by email. **No matching row means no
access.** The application never auto-provisions on an OAuth callback — doing so would grant a
tenant to any stranger with a Google account. Users appear through invitation, which is where the
RBAC screen's existing "Invite user" button becomes functional.

**Tenant switcher.** Rendered in `TopBar` for platform admins only. Switching sets
`activeTenantId` in the session; subsequent reads run under normal RLS for that single tenant.
`TenantProvider` keeps its exact public shape — `useTenant()` still returns `{tenant, role}` —
but receives its value as a server prop instead of the module constant.

---

## 6. Seed data

`scripts/seed.mjs` converts `lib/data/mock/fixtures.ts` into real rows for tenant `finnovate`:
the tenant, its users, campaigns, ad groups, campaign metrics, creatives, approvals,
conversations, messages and prompt templates.

Seeding from the fixtures is what makes the cutover self-checking. Because the seeded rows and the
fixtures are the same data, **any visual difference after a swap is a bug**.

The seed also grants the first platform admin. The email is supplied via a required
`SEED_PLATFORM_ADMIN_EMAIL` environment variable rather than hardcoded, and the seed inserts the
matching `users` row's id into `platform_admins`. Without that variable the seed refuses to run,
so a deployment can never silently produce a database with no way in — and equally never produce
one with an unintended admin baked into committed source.

The seed is idempotent — re-running it updates rather than duplicates — so it is safe against a
long-lived development branch.

---

## 7. Cutover strategy

Sequenced so the application is never left broken:

1. **Migration 0003 + seed.** Fixtures become real rows. The app still reads fixtures. Nothing
   changes on screen.
2. **Repositories + the `query` path.** Tested directly against a Neon branch. Still nothing on
   screen.
3. **Auth + middleware.** The app now requires login, still rendering fixtures.
4. **Swap `lib/data` one function at a time.** Each function flips from `delay(fx.x)` to a
   repository call. The full test suite runs after every flip.

Fixtures are **not deleted**. They remain the source for seed data and the fallback when
`NEON_DATABASE_URL` is unset, so tests and local development run without a database.

---

## 8. Error handling

| Condition | Behaviour |
|---|---|
| Unauthenticated | Redirect to `/login` |
| Authenticated, no `users` row | Dedicated "no access" page, not a crash |
| Database unreachable | Existing `EmptyState` with retry, scoped per screen so one failing panel does not blank the dashboard |
| RLS returns zero rows | A legitimate empty state, never an error — this is fail-closed working as designed |

---

## 9. Testing

The existing 47 tests staying green is the contract for the whole phase. Added:

- **Repository tests** against a real Neon branch, not mocks — RLS is the behaviour under test.
- **RLS isolation tests, per tenant-owned table:** establish tenant A's context, query tenant B's
  rows, assert zero returned.
- **Bypass red-team tests:** `withPlatformReadContext` rejects non-`select` statements; the normal
  application pool cannot bypass RLS; every bypass invocation writes an audit row.
- **Auth tests:** unauthenticated requests redirect; an unknown email is denied; the tenant
  switcher changes query scope.
- **Seed round-trip test:** repository output matches the fixture shape, protecting the cutover
  invariant in §6.

---

## 10. Definition of done

Log in with Google and land on Analytics, where every number came out of Neon under row-level
security. Campaigns, Studio, Approvals, Workspace and Integrations all read real tenant-scoped
rows. Approving an item writes a real status transition and a real audit event. The tenant
switcher moves a platform admin between tenants without any RLS bypass. All tests pass.

---

## 11. Known deferrals carried forward

The six spec-detail gaps in `docs/superpowers/followups.md` (Approvals edit affordance, Studio
acknowledge-to-ship, Workspace typewriter and file chip, Campaigns sortable columns and drawer
chart) remain open. Phase A makes two of them cheaper rather than fixing them: `campaign_metrics`
supplies the real series the drawer chart needs, and the `approvals.payload` column supplies the
editable payload the edit affordance needs. Both stay on the backlog.

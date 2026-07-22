# HELM Phase A — Real Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a real, authenticated, tenant-isolated Neon database behind HELM's existing UI so every screen renders rows fetched under row-level security instead of hardcoded fixtures.

**Architecture:** Two deliberate seams stay in place — `lib/data/index.ts` (server-side reads) and `lib/tenant.tsx` (client tenant context). Behind them we add a repository layer, each module taking a transaction that already has RLS context established and returning UI-shaped domain types. Migration 0003 adds the tables the screens already imply. The mock→DB cutover happens one `lib/data` function at a time, with the full test suite run after each flip.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Neon serverless Postgres (`@neondatabase/serverless`), NextAuth v4, Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-22-helm-phase-a-real-spine-design.md`

## Global Constraints

- All work happens in `F:\Codes\HELM\helm-app`. Repo root is `F:\Codes\HELM`.
- **The existing 22 test files / 47 tests must stay green after every single task.** This is the contract for the whole phase. Run `npm test` before committing, every time.
- Never add a required method to the existing `TenantTransaction` interface — widen by extension only (§3.3 of spec). `lib/server/db.ts:31` declares a typed object literal that would fail to compile.
- Money is stored as integer minor units (paise) in columns suffixed `_minor`. Never floating point.
- Every tenant-owned table gets `tenant_id uuid not null references tenants(id)`, RLS `enable`d **and** `force`d, plus an isolation policy using `helm_tenant_id()`.
- A tenant id is never read from browser input. It comes from the session only.
- Fixtures in `lib/data/mock/fixtures.ts` are **never deleted**. They remain the seed source and the no-database fallback.
- The database role enum is canonical; UI role names are produced by a boundary mapping. Do not rename UI roles.
- TypeScript is `strict`. No `any` in new code.
- Import alias `@/` maps to the `helm-app` root.

---

## File Structure

**Created:**
- `db/migrations/0003_operate_core.sql` — tables, enums, RLS policies, indexes
- `db/migrations/0004_platform_reader.sql` — bypass role + grants
- `lib/server/role-mapping.ts` — DB enum ↔ UI role, exhaustive both ways
- `lib/server/platform-read.ts` — the single audited RLS-bypass path
- `lib/server/tenant-session.ts` — session → `TenantContext`
- `lib/repositories/campaigns.ts` — campaigns, ad groups, metrics, detail
- `lib/repositories/approvals.ts` — approvals list + decisions
- `lib/repositories/creatives.ts` — creatives / studio variants
- `lib/repositories/conversations.ts` — workspace chat + prompt templates
- `lib/repositories/directory.ts` — users, integrations, tenant
- `scripts/seed.mjs` — fixtures → real rows, idempotent
- `middleware.ts` — route protection
- `app/login/page.tsx` — sign-in
- `app/no-access/page.tsx` — authenticated but unprovisioned
- `components/shell/TenantSwitcher.tsx` — platform-admin tenant selection
- Test files listed per task

**Modified:**
- `lib/server/tenant-context.ts` — add `TenantQueryTransaction` (extends, not mutates)
- `lib/server/db.ts` — implement `query`, widen callback type
- `lib/data/index.ts` — swap fixture returns for repository calls
- `lib/tenant.tsx` — accept a server-supplied value, same public shape
- `app/(app)/layout.tsx` — pass real tenant/role into the provider
- `components/shell/TopBar.tsx` — mount the switcher
- `lib/server/env.ts` — add `platformReaderUrl`
- `.env.example` — document new variables

---

## Task 1: Add a read path to the transaction interface

**Files:**
- Modify: `lib/server/tenant-context.ts`
- Modify: `lib/server/db.ts:25-49`
- Test: `test/db-query.test.ts` (create)

**Interfaces:**
- Consumes: existing `TenantTransaction`, `TenantContext` from `lib/server/tenant-context.ts`
- Produces: `TenantQueryTransaction` (extends `TenantTransaction`, adds `query<T>(statement: string, values?: readonly unknown[]): Promise<T[]>`); `withTenantContext<T>(input: TenantContext, work: (tx: TenantQueryTransaction) => Promise<T>): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `test/db-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TenantQueryTransaction } from '@/lib/server/tenant-context'
import { establishTenantContext } from '@/lib/server/tenant-context'
import { appendAuditEvent } from '@/lib/server/audit'

function fakeTx() {
  const calls: { statement: string; values?: readonly unknown[] }[] = []
  const tx: TenantQueryTransaction = {
    execute: async (statement, values) => { calls.push({ statement, values }) },
    query: async <T>() => [] as T[],
  }
  return { tx, calls }
}

const context = { tenantId: '11111111-1111-1111-1111-111111111111', userId: 'u1', role: 'owner' as const, scopes: [] }

describe('TenantQueryTransaction', () => {
  it('still satisfies the write-only TenantTransaction contract', async () => {
    const { tx, calls } = fakeTx()
    await establishTenantContext(tx, context)
    expect(calls[0].statement).toContain('set_config')
    await appendAuditEvent(tx, context, { actorType: 'user', actorId: 'u1', action: 'test', target: 't' })
    expect(calls[1].statement).toContain('insert into audit_log')
  })

  it('exposes a row-returning query method', async () => {
    const tx: TenantQueryTransaction = {
      execute: async () => {},
      query: async <T>() => [{ ok: true }] as T[],
    }
    const rows = await tx.query<{ ok: boolean }>('select true as ok')
    expect(rows[0].ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- db-query`
Expected: FAIL — `TenantQueryTransaction` is not exported from `lib/server/tenant-context`.

- [ ] **Step 3: Add the extending interface**

In `lib/server/tenant-context.ts`, immediately after the existing `TenantTransaction` interface, add:

```ts
/**
 * A transaction that can also read. Repositories require this; writers such as
 * appendAuditEvent keep accepting the narrower write-only TenantTransaction so
 * existing callers and their tests compile unchanged.
 */
export interface TenantQueryTransaction extends TenantTransaction {
  query<T>(statement: string, values?: readonly unknown[]): Promise<T[]>
}
```

Do **not** modify the existing `TenantTransaction` interface.

- [ ] **Step 4: Implement query in withTenantContext**

In `lib/server/db.ts`, change the import to include the new type, then replace the `tx` construction and signature:

```ts
export async function withTenantContext<T>(
  input: TenantContext,
  work: (tx: TenantQueryTransaction) => Promise<T>,
): Promise<T> {
  const context = createTenantContext(input)
  const pool = createPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const tx: TenantQueryTransaction = {
      execute: async (statement, values) => {
        if (values) await client.query(statement, [...values])
        else await client.query(statement)
      },
      query: async <R>(statement: string, values?: readonly unknown[]) => {
        const result = values
          ? await client.query(statement, [...values])
          : await client.query(statement)
        return result.rows as R[]
      },
    }
    await establishTenantContext(tx, context)
    const result = await work(tx)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 23 files, 49 tests. The 47 pre-existing tests must all still pass.

- [ ] **Step 6: Commit**

```bash
git add lib/server/tenant-context.ts lib/server/db.ts test/db-query.test.ts
git commit -m "feat(db): add TenantQueryTransaction read path without breaking writers"
```

---

## Task 2: Role mapping between the DB enum and UI roles

**Files:**
- Create: `lib/server/role-mapping.ts`
- Test: `test/role-mapping.test.ts`

**Interfaces:**
- Consumes: `Role` from `lib/types.ts`; `TenantRole` from `lib/server/tenant-context.ts`
- Produces: `toUiRole(dbRole: TenantRole): Role`; `toDbRole(uiRole: Role): TenantRole`

- [ ] **Step 1: Write the failing test**

Create `test/role-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toUiRole, toDbRole } from '@/lib/server/role-mapping'
import type { TenantRole } from '@/lib/server/tenant-context'

const DB_ROLES: TenantRole[] = ['owner', 'agency_admin', 'strategist', 'creative', 'analyst', 'client_viewer']

describe('role mapping', () => {
  it('maps the database enum to UI role names', () => {
    expect(toUiRole('owner')).toBe('master')
    expect(toUiRole('agency_admin')).toBe('agency')
    expect(toUiRole('client_viewer')).toBe('viewer')
    expect(toUiRole('strategist')).toBe('strategist')
  })

  it('round-trips every database role', () => {
    for (const role of DB_ROLES) {
      expect(toDbRole(toUiRole(role))).toBe(role)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- role-mapping`
Expected: FAIL — cannot resolve `@/lib/server/role-mapping`.

- [ ] **Step 3: Implement the mapping**

Create `lib/server/role-mapping.ts`:

```ts
import 'server-only'
import type { Role } from '../types'
import type { TenantRole } from './tenant-context'

/**
 * The database enum is canonical. These records are exhaustive in both
 * directions, so adding a role to either vocabulary fails to compile until
 * the mapping is updated.
 */
const DB_TO_UI: Record<TenantRole, Role> = {
  owner: 'master',
  agency_admin: 'agency',
  strategist: 'strategist',
  creative: 'creative',
  analyst: 'analyst',
  client_viewer: 'viewer',
}

const UI_TO_DB: Record<Role, TenantRole> = {
  master: 'owner',
  agency: 'agency_admin',
  strategist: 'strategist',
  creative: 'creative',
  analyst: 'analyst',
  viewer: 'client_viewer',
}

export const toUiRole = (dbRole: TenantRole): Role => DB_TO_UI[dbRole]
export const toDbRole = (uiRole: Role): TenantRole => UI_TO_DB[uiRole]
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green, 2 new.

- [ ] **Step 5: Commit**

```bash
git add lib/server/role-mapping.ts test/role-mapping.test.ts
git commit -m "feat(auth): map canonical DB role enum to UI role vocabulary"
```

---

## Task 3: Migration 0003 — operate core tables

**Files:**
- Create: `db/migrations/0003_operate_core.sql`
- Test: `test/migration-0003.test.ts`

**Interfaces:**
- Produces: tables `campaigns`, `ad_groups`, `campaign_metrics`, `creatives`, `approvals`, `conversations`, `messages`, `prompt_templates`, `platform_admins`; enums `campaign_status`, `creative_kind`, `creative_status`, `compliance_verdict`, `approval_status`

- [ ] **Step 1: Write the failing test**

This test asserts on the migration SQL text, so it runs without a database. Create `test/migration-0003.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0003_operate_core.sql'), 'utf8')

const TENANT_OWNED = [
  'campaigns', 'ad_groups', 'campaign_metrics', 'creatives',
  'approvals', 'conversations', 'messages', 'prompt_templates',
]

describe('migration 0003', () => {
  it('creates every operate-core table', () => {
    for (const table of [...TENANT_OWNED, 'platform_admins']) {
      expect(sql).toMatch(new RegExp(`create table ${table} \\(`))
    }
  })

  it('enables AND forces RLS on every tenant-owned table', () => {
    for (const table of TENANT_OWNED) {
      expect(sql).toContain(`alter table ${table} enable row level security;`)
      expect(sql).toContain(`alter table ${table} force row level security;`)
    }
  })

  it('gives every tenant-owned table an isolation policy using helm_tenant_id()', () => {
    for (const table of TENANT_OWNED) {
      expect(sql).toMatch(new RegExp(`create policy ${table}_tenant_isolation on ${table}`))
    }
    const policyCount = (sql.match(/helm_tenant_id\(\)/g) ?? []).length
    expect(policyCount).toBeGreaterThanOrEqual(TENANT_OWNED.length * 2)
  })

  it('deliberately leaves platform_admins outside tenant scope', () => {
    expect(sql).not.toMatch(/alter table platform_admins enable row level security/)
    const block = sql.slice(sql.indexOf('create table platform_admins'))
    expect(block.slice(0, block.indexOf(');'))).not.toContain('tenant_id')
  })

  it('stores money as integer minor units only', () => {
    expect(sql).not.toMatch(/\b(numeric|decimal|float|real|double)\b/i)
    expect(sql).toContain('spend_minor')
    expect(sql).toContain('budget_minor')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- migration-0003`
Expected: FAIL — `ENOENT`, the migration file does not exist.

- [ ] **Step 3: Write the migration**

Create `db/migrations/0003_operate_core.sql`:

```sql
-- HELM operate core: the tables the existing screens already imply.
-- Every tenant-owned table repeats the 0001 pattern: tenant_id FK, RLS
-- enabled AND forced, isolation policy via helm_tenant_id().
-- Money is integer minor units (paise). Never floating point.

create type campaign_status as enum ('active', 'review', 'paused');
create type creative_kind as enum ('image', 'video', 'copy');
create type creative_status as enum ('live', 'review', 'draft');
create type compliance_verdict as enum ('pass', 'flag');
create type approval_status as enum ('pending', 'approved', 'rejected');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  external_ref text not null,
  name text not null,
  channel text not null,
  status campaign_status not null default 'review',
  objective text not null default '',
  spend_minor bigint not null default 0,
  budget_minor bigint not null default 0,
  results integer not null default 0,
  cac_minor bigint,
  roas integer not null default 0,
  started_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table ad_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  external_ref text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  spend_minor bigint not null default 0,
  results integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  metric_date date not null,
  spend_minor bigint not null default 0,
  results integer not null default 0,
  unique (campaign_id, metric_date)
);

create table creatives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  campaign_id uuid references campaigns(id) on delete set null,
  external_ref text not null,
  kind creative_kind not null,
  label text not null,
  status creative_status not null default 'draft',
  headline text not null default '',
  body text,
  grad_from text not null default 'violet',
  grad_to text not null default 'sky',
  compliance compliance_verdict not null default 'pass',
  compliance_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  external_ref text not null,
  agent text not null,
  agent_code text not null,
  action text not null,
  summary text not null,
  payload jsonb not null default '{}',
  checks jsonb not null default '[]',
  status approval_status not null default 'pending',
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (tenant_id, external_ref)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  user_id uuid not null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table prompt_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  external_ref text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

-- Deliberately outside tenant scope: no tenant_id, no RLS. Reachable only
-- through the audited read-only path in lib/server/platform-read.ts.
create table platform_admins (
  user_id uuid primary key references users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null default 'seed'
);

-- The integrations table from 0001 has no auth-kind column, but the UI's
-- IntegrationDetail.auth distinguishes OAuth 2.1 / API key / token.
alter table integrations add column auth_kind text not null default 'OAuth 2.1'
  check (auth_kind in ('OAuth 2.1', 'API key', 'token'));

create index campaigns_tenant_status_idx on campaigns (tenant_id, status);
create index approvals_tenant_status_idx on approvals (tenant_id, status);
create index campaign_metrics_campaign_date_idx on campaign_metrics (campaign_id, metric_date);
create index messages_conversation_created_idx on messages (conversation_id, created_at);
create index ad_groups_campaign_idx on ad_groups (campaign_id);
create index creatives_tenant_idx on creatives (tenant_id);

alter table campaigns enable row level security;
alter table ad_groups enable row level security;
alter table campaign_metrics enable row level security;
alter table creatives enable row level security;
alter table approvals enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table prompt_templates enable row level security;

alter table campaigns force row level security;
alter table ad_groups force row level security;
alter table campaign_metrics force row level security;
alter table creatives force row level security;
alter table approvals force row level security;
alter table conversations force row level security;
alter table messages force row level security;
alter table prompt_templates force row level security;

create policy campaigns_tenant_isolation on campaigns
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy ad_groups_tenant_isolation on ad_groups
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy campaign_metrics_tenant_isolation on campaign_metrics
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy creatives_tenant_isolation on creatives
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy approvals_tenant_isolation on approvals
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy conversations_tenant_isolation on conversations
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy messages_tenant_isolation on messages
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy prompt_templates_tenant_isolation on prompt_templates
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
```

Note on `roas`: stored as an integer in hundredths (3.2× → `320`) to honour the no-floating-point constraint. Repositories divide by 100 on read.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- migration-0003`
Expected: PASS — 5 tests.

- [ ] **Step 5: Apply the migration**

Run: `npm run db:migrate`
Expected: `Applied 0003_operate_core.sql`

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0003_operate_core.sql test/migration-0003.test.ts
git commit -m "feat(db): migration 0003 operate core tables with forced RLS"
```

---

## Task 4: Migration 0004 + the audited platform-read path

**Files:**
- Create: `db/migrations/0004_platform_reader.sql`
- Create: `lib/server/platform-read.ts`
- Modify: `lib/server/env.ts`
- Modify: `.env.example`
- Test: `test/platform-read.test.ts`

**Interfaces:**
- Consumes: `env`, `requireServerEnv` from `lib/server/env.ts`
- Produces: `assertReadOnlyStatement(statement: string): void`; `withPlatformReadContext<T>(actor: { userId: string }, work: (read: PlatformReader) => Promise<T>): Promise<T>` where `PlatformReader = { query<T>(statement: string, values?: readonly unknown[]): Promise<T[]> }`

- [ ] **Step 1: Write the failing test**

Create `test/platform-read.test.ts`. These are the red-team tests — they assert the bypass path refuses anything that is not a read:

```ts
import { describe, it, expect } from 'vitest'
import { assertReadOnlyStatement } from '@/lib/server/platform-read'

describe('platform reader statement guard', () => {
  it('allows plain select statements', () => {
    expect(() => assertReadOnlyStatement('select count(*) from campaigns')).not.toThrow()
    expect(() => assertReadOnlyStatement('  SELECT 1  ')).not.toThrow()
    expect(() => assertReadOnlyStatement('with t as (select 1) select * from t')).not.toThrow()
  })

  it('rejects every write verb', () => {
    for (const statement of [
      'insert into campaigns (name) values (1)',
      'update campaigns set name = 1',
      'delete from campaigns',
      'drop table campaigns',
      'alter table campaigns add column x int',
      'truncate campaigns',
      'grant select on campaigns to public',
      'create table x (id int)',
    ]) {
      expect(() => assertReadOnlyStatement(statement)).toThrow(/read-only/i)
    }
  })

  it('rejects stacked statements that smuggle a write past a leading select', () => {
    expect(() => assertReadOnlyStatement('select 1; delete from campaigns')).toThrow(/read-only/i)
    expect(() => assertReadOnlyStatement('select 1;drop table users')).toThrow(/read-only/i)
  })

  it('rejects empty or non-select input', () => {
    expect(() => assertReadOnlyStatement('')).toThrow(/read-only/i)
    expect(() => assertReadOnlyStatement('   ')).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- platform-read`
Expected: FAIL — cannot resolve `@/lib/server/platform-read`.

- [ ] **Step 3: Write the migration**

Create `db/migrations/0004_platform_reader.sql`:

```sql
-- A contained cross-tenant read path for platform admins.
-- This role can bypass RLS, so it is SELECT-only and must never be used by
-- the application's normal connection pool.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'helm_platform_reader') then
    create role helm_platform_reader login bypassrls;
  end if;
end
$$;

grant usage on schema public to helm_platform_reader;
grant select on all tables in schema public to helm_platform_reader;
alter default privileges in schema public grant select on tables to helm_platform_reader;

revoke insert, update, delete, truncate on all tables in schema public from helm_platform_reader;
```

- [ ] **Step 4: Implement the guarded reader**

Create `lib/server/platform-read.ts`:

```ts
import 'server-only'
import { Pool } from '@neondatabase/serverless'
import { requireServerEnv } from './env'

const WRITE_VERBS = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|call|do)\b/i

/**
 * The bypass role can read across every tenant, so the only statements it may
 * ever run are reads. Rejects write verbs anywhere in the statement, which also
 * defeats stacked statements such as "select 1; delete from campaigns".
 */
export function assertReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (!normalized) throw new Error('Platform reads are read-only: empty statement')
  const isSelect = /^(select|with)\b/i.test(normalized)
  if (!isSelect) throw new Error(`Platform reads are read-only: statement must begin with select`)
  if (WRITE_VERBS.test(normalized)) throw new Error('Platform reads are read-only: write verb detected')
}

export interface PlatformReader {
  query<T>(statement: string, values?: readonly unknown[]): Promise<T[]>
}

/**
 * The single path permitted to use the RLS-bypassing reader role. Every
 * invocation writes an audit event through the normal pool before returning.
 */
export async function withPlatformReadContext<T>(
  actor: { userId: string },
  work: (read: PlatformReader) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: requireServerEnv('platformReaderUrl') })
  const client = await pool.connect()
  const statements: string[] = []
  try {
    const read: PlatformReader = {
      query: async <R>(statement: string, values?: readonly unknown[]) => {
        assertReadOnlyStatement(statement)
        statements.push(statement)
        const result = values
          ? await client.query(statement, [...values])
          : await client.query(statement)
        return result.rows as R[]
      },
    }
    return await work(read)
  } finally {
    client.release()
    await pool.end()
    await recordPlatformRead(actor.userId, statements)
  }
}

async function recordPlatformRead(userId: string, statements: readonly string[]) {
  const pool = new Pool({ connectionString: requireServerEnv('databaseUrl') })
  try {
    await pool.query(
      `insert into audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
       select id, 'system', $1, 'platform.cross_tenant_read', 'platform_admins', $2::jsonb
       from tenants order by created_at limit 1`,
      [userId, JSON.stringify({ statementCount: statements.length, statements })],
    )
  } finally {
    await pool.end()
  }
}
```

- [ ] **Step 5: Add the connection string to env**

In `lib/server/env.ts`, add to the `env` object after `databaseUrlUnpooled`:

```ts
  platformReaderUrl: optional('NEON_PLATFORM_READER_URL'),
```

In `.env.example`, add after the existing database block:

```
# RLS-bypassing, SELECT-only reader used solely for cross-tenant platform admin
# views. Must be a different role from the application connection.
NEON_PLATFORM_READER_URL=
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — the 4 new platform-read tests plus everything prior.

- [ ] **Step 7: Apply the migration and commit**

```bash
npm run db:migrate
git add db/migrations/0004_platform_reader.sql lib/server/platform-read.ts lib/server/env.ts .env.example test/platform-read.test.ts
git commit -m "feat(security): audited SELECT-only cross-tenant platform read path"
```

---

## Task 5: Seed script — fixtures become real rows

**Files:**
- Create: `scripts/seed.mjs`
- Modify: `package.json` (add `db:seed` script)
- Test: manual verification via psql-style count query in Step 5

**Interfaces:**
- Consumes: `lib/data/mock/fixtures.ts`; `NEON_DATABASE_URL_UNPOOLED`; `SEED_PLATFORM_ADMIN_EMAIL`
- Produces: rows in every table from Task 3, keyed by `external_ref` matching the fixture `id` values (`c1`…`c8`, `a1`…`a3`)

- [ ] **Step 1: Write the seed script**

Create `scripts/seed.mjs`. It is idempotent via `on conflict … do update`, and refuses to run without an explicit admin email:

```js
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import nextEnv from '@next/env'
import { Pool } from '@neondatabase/serverless'
import { register } from 'node:module'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const connectionString = process.env.NEON_DATABASE_URL_UNPOOLED
if (!connectionString) throw new Error('NEON_DATABASE_URL_UNPOOLED is required in .env.local')

const adminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL
if (!adminEmail) {
  throw new Error(
    'SEED_PLATFORM_ADMIN_EMAIL is required. Set it to the email of the first platform admin so the seed never bakes an identity into source.',
  )
}

// Fixtures are TypeScript; load them through a transpiling loader.
register('tsx/esm', pathToFileURL('./'))
const fx = await import(pathToFileURL(resolve(process.cwd(), 'lib/data/mock/fixtures.ts')).href)

const rupees = (n) => Math.round(n * 100)          // display rupees -> paise
const hundredths = (n) => Math.round(n * 100)      // 3.2x -> 320

const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  await client.query('begin')

  const tenant = await client.query(
    `insert into tenants (slug, name, plan, status) values ($1, $2, 'growth', 'active')
     on conflict (slug) do update set name = excluded.name returning id`,
    [fx.tenant.id, fx.tenant.name],
  )
  const tenantId = tenant.rows[0].id
  console.log(`Tenant ${fx.tenant.name} -> ${tenantId}`)

  for (const user of fx.users) {
    await client.query(
      `insert into users (tenant_id, email, display_name, role, status)
       values ($1, $2, $3, $4::helm_role, $5)
       on conflict (tenant_id, email) do update set display_name = excluded.display_name, role = excluded.role`,
      [tenantId, user.email, user.name, toDbRole(user.role), user.status],
    )
  }

  const admin = await client.query(
    `insert into users (tenant_id, email, display_name, role, status)
     values ($1, $2, 'Platform Admin', 'owner', 'active')
     on conflict (tenant_id, email) do update set role = 'owner' returning id`,
    [tenantId, adminEmail],
  )
  await client.query(
    `insert into platform_admins (user_id, granted_by) values ($1, 'seed')
     on conflict (user_id) do nothing`,
    [admin.rows[0].id],
  )
  console.log(`Platform admin -> ${adminEmail}`)

  for (const c of fx.campaignsFull) {
    const row = await client.query(
      `insert into campaigns (tenant_id, external_ref, name, channel, status, objective,
                              spend_minor, budget_minor, results, cac_minor, roas, started_at, updated_at)
       values ($1,$2,$3,$4,$5::campaign_status,$6,$7,$8,$9,$10,$11,$12, now())
       on conflict (tenant_id, external_ref) do update set
         name = excluded.name, status = excluded.status, spend_minor = excluded.spend_minor,
         budget_minor = excluded.budget_minor, results = excluded.results,
         cac_minor = excluded.cac_minor, roas = excluded.roas, updated_at = now()
       returning id`,
      [tenantId, c.id, c.name, c.channel, c.status, c.objective, rupees(c.spend), rupees(c.budget),
       c.results, c.cac === null ? null : rupees(c.cac), hundredths(c.roas), c.startedAt],
    )
    const campaignId = row.rows[0].id

    const detail = fx.campaignDetail(c.id)
    for (const g of detail.adGroups) {
      await client.query(
        `insert into ad_groups (tenant_id, campaign_id, external_ref, name, status, spend_minor, results)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (tenant_id, external_ref) do update set
           name = excluded.name, spend_minor = excluded.spend_minor, results = excluded.results`,
        [tenantId, campaignId, `${c.id}-${g.id}`, g.name, g.status, rupees(g.spend), g.results],
      )
    }

    // series is 14 points ending 2026-07-22; store one row per day.
    // Must be a for-loop with await: a forEach with un-awaited client.query
    // would race the commit below and silently lose metric rows.
    for (const [index, value] of detail.series.entries()) {
      const day = new Date(Date.UTC(2026, 6, 22) - (13 - index) * 86400000)
      await client.query(
        `insert into campaign_metrics (tenant_id, campaign_id, metric_date, spend_minor, results)
         values ($1,$2,$3,$4,$5)
         on conflict (campaign_id, metric_date) do update set
           spend_minor = excluded.spend_minor, results = excluded.results`,
        [tenantId, campaignId, day.toISOString().slice(0, 10), rupees(value * 100), value],
      )
    }

    for (const cr of detail.creatives) {
      await client.query(
        `insert into creatives (tenant_id, campaign_id, external_ref, kind, label, status, grad_from, grad_to)
         values ($1,$2,$3,$4::creative_kind,$5,$6::creative_status,$7,$8)
         on conflict (tenant_id, external_ref) do update set label = excluded.label, status = excluded.status`,
        [tenantId, campaignId, `${c.id}-${cr.id}`, cr.kind, cr.label, cr.status, cr.grad[0], cr.grad[1]],
      )
    }
  }
  console.log(`Campaigns -> ${fx.campaignsFull.length}`)

  for (const a of fx.approvals) {
    await client.query(
      `insert into approvals (tenant_id, external_ref, agent, agent_code, action, summary, payload, checks, status)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending')
       on conflict (tenant_id, external_ref) do update set
         summary = excluded.summary, payload = excluded.payload, checks = excluded.checks`,
      [tenantId, a.id, a.agent, a.agentCode, a.action, a.summary,
       JSON.stringify({ text: a.payload }), JSON.stringify(a.checks)],
    )
  }
  console.log(`Approvals -> ${fx.approvals.length}`)

  for (const p of fx.promptTemplates) {
    await client.query(
      `insert into prompt_templates (tenant_id, external_ref, title, body)
       values ($1,$2,$3,$4)
       on conflict (tenant_id, external_ref) do update set title = excluded.title, body = excluded.body`,
      [tenantId, p.id, p.title, p.body],
    )
  }

  for (const i of fx.integrationsFull) {
    await client.query(
      `insert into integrations (tenant_id, kind, auth_kind, status, scopes, last_sync_at, updated_at)
       values ($1,$2,$3,$4::integration_status,$5, now(), now())
       on conflict (tenant_id, kind) do update set
         auth_kind = excluded.auth_kind, status = excluded.status, scopes = excluded.scopes`,
      [tenantId, i.name, i.auth, i.status, i.scopes],
    )
  }
  console.log(`Integrations -> ${fx.integrationsFull.length}`)

  await client.query('commit')
  console.log('Seed complete.')
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}

function toDbRole(uiRole) {
  return { master: 'owner', agency: 'agency_admin', strategist: 'strategist',
           creative: 'creative', analyst: 'analyst', viewer: 'client_viewer' }[uiRole]
}
```

- [ ] **Step 2: Add tsx and the npm script**

Run: `npm install --save-dev tsx`

In `package.json` `scripts`, add:

```json
    "db:seed": "node scripts/seed.mjs",
```

- [ ] **Step 3: Set the admin email**

Add to `.env.local` (not committed):

```
SEED_PLATFORM_ADMIN_EMAIL=aniket@letstutecreation.com
```

Add to `.env.example`:

```
# Email of the first platform admin. Required by scripts/seed.mjs.
SEED_PLATFORM_ADMIN_EMAIL=
```

- [ ] **Step 4: Run the seed**

Run: `npm run db:seed`
Expected output includes `Tenant Finnovate -> <uuid>`, `Campaigns -> 8`, `Approvals -> 3`, `Seed complete.`

- [ ] **Step 5: Verify idempotency**

Run: `npm run db:seed`
Expected: identical output, no unique-constraint errors. Running twice must not duplicate rows.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS — the seed changes no application code, so all tests stay green.

```bash
git add scripts/seed.mjs package.json package-lock.json .env.example
git commit -m "feat(db): idempotent seed porting fixtures to real rows"
```

---

## Task 6: Campaigns repository

**Files:**
- Create: `lib/repositories/campaigns.ts`
- Test: `test/repositories-campaigns.test.ts`

**Interfaces:**
- Consumes: `TenantQueryTransaction` (Task 1); `CampaignFull`, `CampaignDetail`, `AdGroup`, `CreativeAsset`, `SeriesColor` from `lib/types.ts`
- Produces: `listCampaigns(tx: TenantQueryTransaction): Promise<CampaignFull[]>`; `getCampaignDetailRow(tx: TenantQueryTransaction, externalRef: string): Promise<CampaignDetail | null>`; `channelColor(channel: string): SeriesColor`

- [ ] **Step 1: Write the failing test**

The repository takes a transaction, so it is tested with a stub — no database required, and the SQL shape plus the row mapping are what is under test. Create `test/repositories-campaigns.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listCampaigns, channelColor } from '@/lib/repositories/campaigns'
import type { TenantQueryTransaction } from '@/lib/server/tenant-context'

function stubTx(rows: unknown[]): { tx: TenantQueryTransaction; seen: string[] } {
  const seen: string[] = []
  const tx: TenantQueryTransaction = {
    execute: async () => {},
    query: async <T>(statement: string) => { seen.push(statement); return rows as T[] },
  }
  return { tx, seen }
}

describe('campaigns repository', () => {
  it('maps minor units back to display rupees and hundredths back to roas', async () => {
    const { tx } = stubTx([{
      external_ref: 'c1', name: 'FHC · Retargeting', channel: 'Meta', status: 'active',
      objective: 'Lowest CAC / checkup', spend_minor: '15600000', budget_minor: '23000000',
      results: 458, cac_minor: '34100', roas: 320, started_at: new Date('2026-06-18T00:00:00Z'),
    }])
    const [campaign] = await listCampaigns(tx)
    expect(campaign.id).toBe('c1')
    expect(campaign.spend).toBe(156000)
    expect(campaign.budget).toBe(230000)
    expect(campaign.cac).toBe(341)
    expect(campaign.roas).toBe(3.2)
    expect(campaign.pacingPct).toBe(68)
    expect(campaign.startedAt).toBe('2026-06-18')
  })

  it('preserves a null cac rather than coercing it to zero', async () => {
    const { tx } = stubTx([{
      external_ref: 'c4', name: 'Reels · Awareness', channel: 'Meta', status: 'review',
      objective: 'Top-of-funnel reach', spend_minor: '0', budget_minor: '8000000',
      results: 0, cac_minor: null, roas: 0, started_at: new Date('2026-07-15T00:00:00Z'),
    }])
    const [campaign] = await listCampaigns(tx)
    expect(campaign.cac).toBeNull()
    expect(campaign.pacingPct).toBe(0)
  })

  it('never interpolates a tenant id into SQL', async () => {
    const { tx, seen } = stubTx([])
    await listCampaigns(tx)
    expect(seen[0]).not.toMatch(/tenant_id\s*=\s*'/)
  })

  it('assigns the channel colours the UI expects', () => {
    expect(channelColor('Meta')).toBe('violet')
    expect(channelColor('Google')).toBe('amber')
    expect(channelColor('Email')).toBe('sky')
    expect(channelColor('WhatsApp')).toBe('emerald')
    expect(channelColor('Unknown')).toBe('violet')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- repositories-campaigns`
Expected: FAIL — cannot resolve `@/lib/repositories/campaigns`.

- [ ] **Step 3: Implement the repository**

Create `lib/repositories/campaigns.ts`:

```ts
import 'server-only'
import type { TenantQueryTransaction } from '../server/tenant-context'
import type { AdGroup, CampaignDetail, CampaignFull, CreativeAsset, SeriesColor } from '../types'

interface CampaignRowShape {
  external_ref: string
  name: string
  channel: string
  status: CampaignFull['status']
  objective: string
  spend_minor: string | number
  budget_minor: string | number
  results: number
  cac_minor: string | number | null
  roas: number
  started_at: Date | string | null
}

const CHANNEL_COLORS: Record<string, SeriesColor> = {
  Meta: 'violet', Google: 'amber', Email: 'sky', WhatsApp: 'emerald',
}

export const channelColor = (channel: string): SeriesColor => CHANNEL_COLORS[channel] ?? 'violet'

const toRupees = (minor: string | number) => Math.round(Number(minor) / 100)
const toIsoDate = (value: Date | string | null) =>
  value === null ? '' : (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10)

function toCampaignFull(row: CampaignRowShape): CampaignFull {
  const spend = toRupees(row.spend_minor)
  const budget = toRupees(row.budget_minor)
  return {
    id: row.external_ref,
    name: row.name,
    channel: row.channel,
    channelColor: channelColor(row.channel),
    status: row.status,
    spend,
    budget,
    pacingPct: budget === 0 ? 0 : Math.round((spend / budget) * 100),
    results: row.results,
    cac: row.cac_minor === null ? null : toRupees(row.cac_minor),
    roas: row.roas / 100,
    objective: row.objective,
    startedAt: toIsoDate(row.started_at),
  }
}

const SELECT_CAMPAIGN = `
  select external_ref, name, channel, status, objective, spend_minor, budget_minor,
         results, cac_minor, roas, started_at
  from campaigns`

export async function listCampaigns(tx: TenantQueryTransaction): Promise<CampaignFull[]> {
  const rows = await tx.query<CampaignRowShape>(`${SELECT_CAMPAIGN} order by started_at desc, name asc`)
  return rows.map(toCampaignFull)
}

export async function getCampaignDetailRow(
  tx: TenantQueryTransaction,
  externalRef: string,
): Promise<CampaignDetail | null> {
  const [row] = await tx.query<CampaignRowShape>(`${SELECT_CAMPAIGN} where external_ref = $1`, [externalRef])
  if (!row) return null
  const campaign = toCampaignFull(row)

  const groupRows = await tx.query<{ external_ref: string; name: string; status: AdGroup['status']; spend_minor: string; results: number }>(
    `select g.external_ref, g.name, g.status, g.spend_minor, g.results
     from ad_groups g join campaigns c on c.id = g.campaign_id
     where c.external_ref = $1 order by g.name asc`,
    [externalRef],
  )

  const creativeRows = await tx.query<{ external_ref: string; kind: CreativeAsset['kind']; label: string; status: CreativeAsset['status']; grad_from: SeriesColor; grad_to: SeriesColor }>(
    `select cr.external_ref, cr.kind, cr.label, cr.status, cr.grad_from, cr.grad_to
     from creatives cr join campaigns c on c.id = cr.campaign_id
     where c.external_ref = $1 order by cr.created_at asc`,
    [externalRef],
  )

  const metricRows = await tx.query<{ results: number }>(
    `select m.results from campaign_metrics m join campaigns c on c.id = m.campaign_id
     where c.external_ref = $1 order by m.metric_date asc limit 14`,
    [externalRef],
  )

  return {
    campaign,
    adGroups: groupRows.map((g) => ({
      id: g.external_ref.replace(`${externalRef}-`, ''),
      name: g.name,
      status: g.status,
      spend: toRupees(g.spend_minor),
      results: g.results,
    })),
    creatives: creativeRows.map((cr) => ({
      id: cr.external_ref.replace(`${externalRef}-`, ''),
      kind: cr.kind,
      label: cr.label,
      status: cr.status,
      grad: [cr.grad_from, cr.grad_to],
    })),
    series: metricRows.map((m) => m.results),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- repositories-campaigns`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/repositories/campaigns.ts test/repositories-campaigns.test.ts
git commit -m "feat(data): campaigns repository mapping DB rows to UI types"
```

---

## Task 7: Approvals, creatives, conversations and directory repositories

**Files:**
- Create: `lib/repositories/approvals.ts`
- Create: `lib/repositories/conversations.ts`
- Create: `lib/repositories/directory.ts`
- Test: `test/repositories-rest.test.ts`

**Interfaces:**
- Consumes: `TenantQueryTransaction`; `ApprovalItem`, `PromptTemplate`, `IntegrationDetail`, `User`, `Tenant` from `lib/types.ts`; `toUiRole` from `lib/server/role-mapping.ts` (Task 2)
- Produces:
  - `listApprovals(tx): Promise<ApprovalItem[]>`
  - `decideApproval(tx, ctx, input: { externalRef: string; decision: 'approved' | 'rejected' }): Promise<void>`
  - `listPromptTemplates(tx): Promise<PromptTemplate[]>`
  - `listUsers(tx): Promise<User[]>`
  - `listIntegrations(tx): Promise<IntegrationDetail[]>`
  - `getTenantById(tx, tenantId: string): Promise<Tenant | null>`
  - `listSwitchableTenants(tx): Promise<Tenant[]>`

- [ ] **Step 1: Write the failing test**

Create `test/repositories-rest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listApprovals, decideApproval } from '@/lib/repositories/approvals'
import { listUsers } from '@/lib/repositories/directory'
import type { TenantQueryTransaction } from '@/lib/server/tenant-context'

function stubTx(rows: unknown[]) {
  const executed: { statement: string; values?: readonly unknown[] }[] = []
  const tx: TenantQueryTransaction = {
    execute: async (statement, values) => { executed.push({ statement, values }) },
    query: async <T>() => rows as T[],
  }
  return { tx, executed }
}

const ctx = { tenantId: '11111111-1111-1111-1111-111111111111', userId: 'u1', role: 'owner' as const, scopes: [] }

describe('approvals repository', () => {
  it('unwraps the jsonb payload and checks into UI shape', async () => {
    const { tx } = stubTx([{
      external_ref: 'a1', agent: 'Media Buyer', agent_code: 'MB', action: 'Budget shift',
      summary: '+₹15K to Lookalike 2%', payload: { text: 'Move ₹15,000/day.' },
      checks: [{ label: 'Within daily cap', status: 'pass' }],
      proposed_at: new Date('2026-07-22T14:02:00Z'),
    }])
    const [item] = await listApprovals(tx)
    expect(item.id).toBe('a1')
    expect(item.agentCode).toBe('MB')
    expect(item.payload).toBe('Move ₹15,000/day.')
    expect(item.checks[0].status).toBe('pass')
  })

  it('records a decision as a status transition, never a delete', async () => {
    const { tx, executed } = stubTx([])
    await decideApproval(tx, ctx, { externalRef: 'a1', decision: 'approved' })
    const statements = executed.map((e) => e.statement).join(' ')
    expect(statements).toContain('update approvals')
    expect(statements).not.toMatch(/delete\s+from\s+approvals/i)
    expect(statements).toContain('insert into audit_log')
  })
})

describe('directory repository', () => {
  it('converts database roles to UI role names', async () => {
    const { tx } = stubTx([
      { id: 'u1', display_name: 'Aniket', email: 'a@x.com', role: 'owner', status: 'active' },
      { id: 'u2', display_name: 'Riya', email: 'r@x.com', role: 'client_viewer', status: 'invited' },
    ])
    const users = await listUsers(tx)
    expect(users[0].role).toBe('master')
    expect(users[1].role).toBe('viewer')
    expect(users[1].status).toBe('invited')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- repositories-rest`
Expected: FAIL — cannot resolve `@/lib/repositories/approvals`.

- [ ] **Step 3: Implement approvals**

Create `lib/repositories/approvals.ts`:

```ts
import 'server-only'
import type { TenantQueryTransaction, TenantContext } from '../server/tenant-context'
import { appendAuditEvent } from '../server/audit'
import type { ApprovalItem, PolicyCheck } from '../types'

interface ApprovalRowShape {
  external_ref: string
  agent: string
  agent_code: string
  action: string
  summary: string
  payload: { text?: string } | null
  checks: PolicyCheck[] | null
  proposed_at: Date | string
}

const toTimeLabel = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(11, 16)
}

export async function listApprovals(tx: TenantQueryTransaction): Promise<ApprovalItem[]> {
  const rows = await tx.query<ApprovalRowShape>(
    `select external_ref, agent, agent_code, action, summary, payload, checks, proposed_at
     from approvals where status = 'pending' order by proposed_at desc`,
  )
  return rows.map((row) => ({
    id: row.external_ref,
    agent: row.agent,
    agentCode: row.agent_code,
    action: row.action,
    summary: row.summary,
    payload: row.payload?.text ?? '',
    proposedAt: toTimeLabel(row.proposed_at),
    checks: row.checks ?? [],
  }))
}

/** Decisions transition status and append an audit event. Rows are never deleted. */
export async function decideApproval(
  tx: TenantQueryTransaction,
  context: TenantContext,
  input: { externalRef: string; decision: 'approved' | 'rejected' },
): Promise<void> {
  await tx.execute(
    `update approvals set status = $1::approval_status, decided_at = now(), decided_by = $2
     where external_ref = $3 and status = 'pending'`,
    [input.decision, context.userId, input.externalRef],
  )
  await appendAuditEvent(tx, context, {
    actorType: 'user',
    actorId: context.userId,
    action: `approval.${input.decision}`,
    target: input.externalRef,
  })
}
```

- [ ] **Step 4: Implement conversations and directory**

Create `lib/repositories/conversations.ts`:

```ts
import 'server-only'
import type { TenantQueryTransaction } from '../server/tenant-context'
import type { PromptTemplate } from '../types'

export async function listPromptTemplates(tx: TenantQueryTransaction): Promise<PromptTemplate[]> {
  const rows = await tx.query<{ external_ref: string; title: string; body: string }>(
    'select external_ref, title, body from prompt_templates order by created_at asc',
  )
  return rows.map((row) => ({ id: row.external_ref, title: row.title, body: row.body }))
}
```

Create `lib/repositories/directory.ts`:

```ts
import 'server-only'
import type { TenantQueryTransaction } from '../server/tenant-context'
import type { TenantRole } from '../server/tenant-context'
import { toUiRole } from '../server/role-mapping'
import type { IntegrationDetail, SeriesColor, Tenant, User } from '../types'

export async function listUsers(tx: TenantQueryTransaction): Promise<User[]> {
  const rows = await tx.query<{ id: string; display_name: string; email: string; role: TenantRole; status: User['status'] }>(
    'select id, display_name, email, role, status from users order by display_name asc',
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    email: row.email,
    role: toUiRole(row.role),
    status: row.status,
  }))
}

const INTEGRATION_GRAD: [SeriesColor, SeriesColor] = ['violet', 'sky']

export async function listIntegrations(tx: TenantQueryTransaction): Promise<IntegrationDetail[]> {
  const rows = await tx.query<{
    kind: string
    auth_kind: IntegrationDetail['auth']
    status: IntegrationDetail['status']
    scopes: string[]
    last_sync_at: Date | null
  }>('select kind, auth_kind, status, scopes, last_sync_at from integrations order by kind asc')
  return rows.map((row) => ({
    id: row.kind.toLowerCase().replace(/\s+/g, '-'),
    name: row.kind,
    auth: row.auth_kind,
    status: row.status,
    scopes: row.scopes,
    lastSync: row.last_sync_at ? row.last_sync_at.toISOString().slice(11, 16) : '—',
    calls: '—',
    grad: INTEGRATION_GRAD,
  }))
}

export async function getTenantById(tx: TenantQueryTransaction, tenantId: string): Promise<Tenant | null> {
  const [row] = await tx.query<{ slug: string; name: string }>(
    'select slug, name from tenants where id = $1',
    [tenantId],
  )
  return row ? { id: row.slug, name: row.name, region: 'ap-south-1', env: 'prod' } : null
}

export async function listSwitchableTenants(tx: TenantQueryTransaction): Promise<Tenant[]> {
  const rows = await tx.query<{ slug: string; name: string }>(
    'select slug, name from tenants order by name asc',
  )
  return rows.map((row) => ({ id: row.slug, name: row.name, region: 'ap-south-1', env: 'prod' }))
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- repositories-rest`
Expected: PASS — 3 tests.

Run: `npm test`
Expected: PASS — everything green.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/ test/repositories-rest.test.ts
git commit -m "feat(data): approvals, conversations and directory repositories"
```

---

## Task 8: Session to tenant context

**Files:**
- Create: `lib/server/tenant-session.ts`
- Modify: `auth.ts`
- Modify: `types/next-auth.d.ts`
- Test: `test/tenant-session.test.ts`

**Interfaces:**
- Consumes: `getServerSession`, `authOptions`; `createTenantContext`
- Produces: `resolveMembership(email: string, activeTenantId?: string): Promise<Membership | null>` where `Membership = { tenantId: string; tenantSlug: string; userId: string; role: TenantRole; isPlatformAdmin: boolean }`; `requireTenantContext(): Promise<Readonly<TenantContext>>` (**takes no arguments** — it reads the active-tenant cookie itself, wired in Task 10 Step 7); `scopesForRole(role: TenantRole): readonly string[]`; `NoMembershipError`; `UnauthenticatedError`

- [ ] **Step 1: Write the failing test**

Create `test/tenant-session.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scopesForRole, NoMembershipError } from '@/lib/server/tenant-session'

describe('tenant session', () => {
  it('grants owners every scope and viewers only reads', () => {
    expect(scopesForRole('owner')).toContain('approvals.decide')
    expect(scopesForRole('owner')).toContain('analytics.read')
    expect(scopesForRole('client_viewer')).toEqual(['analytics.read'])
  })

  it('does not let a viewer decide approvals', () => {
    expect(scopesForRole('client_viewer')).not.toContain('approvals.decide')
  })

  it('exposes a distinct error for an authenticated user with no membership', () => {
    const error = new NoMembershipError('stranger@example.com')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/no membership/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tenant-session`
Expected: FAIL — cannot resolve `@/lib/server/tenant-session`.

- [ ] **Step 3: Implement the session bridge**

Create `lib/server/tenant-session.ts`:

```ts
import 'server-only'
import { getServerSession } from 'next-auth'
import { Pool } from '@neondatabase/serverless'
import { authOptions } from '@/auth'
import { requireServerEnv } from './env'
import { createTenantContext, type TenantContext, type TenantRole } from './tenant-context'

export class NoMembershipError extends Error {
  constructor(email: string) { super(`No membership for ${email}`) }
}

export class UnauthenticatedError extends Error {
  constructor() { super('Authentication is required') }
}

const SCOPES: Record<TenantRole, readonly string[]> = {
  owner: ['analytics.read', 'campaigns.write', 'approvals.decide', 'integrations.manage', 'workspace.write'],
  agency_admin: ['analytics.read', 'campaigns.write', 'approvals.decide', 'integrations.manage', 'workspace.write'],
  strategist: ['analytics.read', 'campaigns.write', 'approvals.decide', 'workspace.write'],
  creative: ['analytics.read', 'approvals.decide', 'workspace.write'],
  analyst: ['analytics.read', 'workspace.write'],
  client_viewer: ['analytics.read'],
}

export const scopesForRole = (role: TenantRole): readonly string[] => SCOPES[role]

export interface Membership {
  tenantId: string
  tenantSlug: string
  userId: string
  role: TenantRole
  isPlatformAdmin: boolean
}

/**
 * Looks up an authenticated email in the users table. A missing row means no
 * access: the application never auto-provisions from an OAuth callback.
 */
export async function resolveMembership(email: string, activeTenantId?: string): Promise<Membership | null> {
  const pool = new Pool({ connectionString: requireServerEnv('databaseUrl') })
  try {
    const { rows } = await pool.query(
      `select u.id, u.tenant_id, u.role, t.slug,
              (pa.user_id is not null) as is_platform_admin
       from users u
       join tenants t on t.id = u.tenant_id
       left join platform_admins pa on pa.user_id = u.id
       where lower(u.email) = lower($1) and u.status = 'active'
       limit 1`,
      [email],
    )
    const row = rows[0]
    if (!row) return null

    let tenantId = row.tenant_id as string
    let tenantSlug = row.slug as string
    if (activeTenantId && row.is_platform_admin) {
      const switched = await pool.query('select id, slug from tenants where id = $1', [activeTenantId])
      if (switched.rows[0]) {
        tenantId = switched.rows[0].id
        tenantSlug = switched.rows[0].slug
      }
    }

    return {
      tenantId,
      tenantSlug,
      userId: row.id as string,
      role: row.role as TenantRole,
      isPlatformAdmin: Boolean(row.is_platform_admin),
    }
  } finally {
    await pool.end()
  }
}

// Task 10 Step 7 replaces this body to read the active-tenant cookie. The
// signature is argument-free from the start so no caller ever has to change.
export async function requireTenantContext(): Promise<Readonly<TenantContext>> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) throw new UnauthenticatedError()
  const membership = await resolveMembership(email)
  if (!membership) throw new NoMembershipError(email)
  return createTenantContext({
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role,
    scopes: scopesForRole(membership.role),
  })
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS — 3 new tests, everything else green.

- [ ] **Step 5: Commit**

```bash
git add lib/server/tenant-session.ts test/tenant-session.test.ts
git commit -m "feat(auth): resolve tenant context from session with no auto-provisioning"
```

---

## Task 9: Login page, no-access page and route protection

**Files:**
- Create: `middleware.ts`
- Create: `app/login/page.tsx`
- Create: `app/no-access/page.tsx`
- Test: `test/middleware.test.ts`

**Interfaces:**
- Consumes: `next-auth/middleware`
- Produces: `config.matcher` protecting all routes except `/login`, `/no-access`, `/api/auth/*`, `/api/health`

- [ ] **Step 1: Write the failing test**

Create `test/middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { config } from '@/middleware'

function matches(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname))
}

describe('route protection matcher', () => {
  it('protects application routes', () => {
    for (const path of ['/analytics', '/campaigns', '/approvals', '/studio', '/workspace', '/rbac']) {
      expect(matches(path)).toBe(true)
    }
  })

  it('leaves auth, health, login and no-access reachable', () => {
    for (const path of ['/login', '/no-access', '/api/auth/signin', '/api/auth/callback/google', '/api/health']) {
      expect(matches(path)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- middleware`
Expected: FAIL — cannot resolve `@/middleware`.

- [ ] **Step 3: Create the middleware**

Create `middleware.ts` at the `helm-app` root:

```ts
export { default } from 'next-auth/middleware'

/**
 * Everything is protected except authentication endpoints, the health probe,
 * the login screen, the no-access screen and Next's static assets.
 */
export const config = {
  matcher: ['/((?!api/auth|api/health|login|no-access|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 4: Create the login page**

Create `app/login/page.tsx`:

```tsx
'use client'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'

export default function LoginPage() {
  return (
    <main className="login">
      <div className="login-card">
        <h1>HELM</h1>
        <p>Marketing operations control plane</p>
        <Button variant="primary" onClick={() => signIn('google', { callbackUrl: '/analytics' })}>
          Continue with Google
        </Button>
        <Button onClick={() => signIn('azure-ad', { callbackUrl: '/analytics' })}>
          Continue with Microsoft
        </Button>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Create the no-access page**

Create `app/no-access/page.tsx`:

```tsx
export default function NoAccessPage() {
  return (
    <main className="login">
      <div className="login-card">
        <h1>No access</h1>
        <p>
          Your account signed in successfully but is not a member of any workspace.
          Ask a workspace administrator to invite you, then sign in again.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Add login styles**

Append to `app/globals.css`:

```css
.login { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.login-card {
  display: flex; flex-direction: column; gap: 12px; width: min(360px, 100%);
  padding: 32px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel);
}
.login-card h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
.login-card p { margin: 0 0 8px; color: var(--faint); font-size: 14px; line-height: 1.5; }
```

- [ ] **Step 7: Run the full suite and verify manually**

Run: `npm test`
Expected: PASS — 2 new tests.

Run: `npm run dev`, open `http://localhost:3000/analytics`.
Expected: redirected to `/login`. This is the moment the app stops being public.

- [ ] **Step 8: Commit**

```bash
git add middleware.ts app/login app/no-access app/globals.css test/middleware.test.ts
git commit -m "feat(auth): login, no-access and middleware route protection"
```

---

## Task 10: Real tenant context in the provider and the tenant switcher

**Files:**
- Modify: `lib/tenant.tsx`
- Modify: `app/(app)/layout.tsx`
- Create: `components/shell/TenantSwitcher.tsx`
- Modify: `components/shell/TopBar.tsx`
- Test: `test/tenant-provider.test.tsx`

**Interfaces:**
- Consumes: `requireTenantContext`, `resolveMembership` (Task 8); `toUiRole` (Task 2); `getTenantRow` (Task 7)
- Produces: `TenantProvider` gains an optional `value?: { tenant: Tenant; role: Role }` prop; `useTenant()` keeps its exact return shape

- [ ] **Step 1: Write the failing test**

Create `test/tenant-provider.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TenantProvider, useTenant } from '@/lib/tenant'

function Probe() {
  const { tenant, role } = useTenant()
  return <span data-testid="probe">{tenant.name}:{role}</span>
}

describe('TenantProvider', () => {
  it('falls back to Finnovate when no value is supplied', () => {
    render(<TenantProvider><Probe /></TenantProvider>)
    expect(screen.getByTestId('probe')).toHaveTextContent('Finnovate:master')
  })

  it('uses a server-supplied tenant and role', () => {
    const value = {
      tenant: { id: 'acme', name: 'Acme', region: 'ap-south-1', env: 'prod' },
      role: 'analyst' as const,
    }
    render(<TenantProvider value={value}><Probe /></TenantProvider>)
    expect(screen.getByTestId('probe')).toHaveTextContent('Acme:analyst')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tenant-provider`
Expected: FAIL — `TenantProvider` does not accept a `value` prop.

- [ ] **Step 3: Widen the provider**

Replace `lib/tenant.tsx` with:

```tsx
'use client'
import { createContext, useContext, ReactNode } from 'react'
import type { Tenant, Role } from './types'

export interface TenantValue { tenant: Tenant; role: Role }

/** Fallback for tests and for local development without a database. */
const FALLBACK: TenantValue = {
  tenant: { id: 'finnovate', name: 'Finnovate', region: 'ap-south-1', env: 'prod' },
  role: 'master',
}

const Ctx = createContext<TenantValue>(FALLBACK)

export function TenantProvider({ value, children }: { value?: TenantValue; children: ReactNode }) {
  return <Ctx.Provider value={value ?? FALLBACK}>{children}</Ctx.Provider>
}

export const useTenant = () => useContext(Ctx)
```

- [ ] **Step 4: Feed it from the server layout**

Replace `app/(app)/layout.tsx` with:

```tsx
import { TenantProvider, type TenantValue } from '@/lib/tenant'
import { ApprovalsProvider } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/shell/AppShell'
import { getCurrentTenantValue } from '@/lib/data'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const value: TenantValue | undefined = await getCurrentTenantValue()
  return (
    <TenantProvider value={value}>
      <ApprovalsProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </ApprovalsProvider>
    </TenantProvider>
  )
}
```

`getCurrentTenantValue` is added to `lib/data` in Task 11.

- [ ] **Step 5: Add the tenant switcher route handler**

Create `app/api/tenant/switch/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/auth'
import { resolveMembership } from '@/lib/server/tenant-session'

/**
 * Platform admins only. Stores the selected tenant in a cookie that
 * requireTenantContext reads; a non-admin request is rejected outright.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const membership = await resolveMembership(email)
  if (!membership?.isPlatformAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { tenantId } = (await request.json()) as { tenantId?: string }
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const response = NextResponse.json({ ok: true })
  response.cookies.set('helm_active_tenant', tenantId, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/',
  })
  return response
}
```

- [ ] **Step 6: Create the switcher component**

Create `components/shell/TenantSwitcher.tsx`:

```tsx
'use client'
import { useRouter } from 'next/navigation'
import type { Tenant } from '@/lib/types'

export function TenantSwitcher({ tenants, activeId }: { tenants: Tenant[]; activeId: string }) {
  const router = useRouter()
  if (tenants.length <= 1) return null

  return (
    <select
      className="tenant-switcher"
      aria-label="Active workspace"
      value={activeId}
      onChange={async (event) => {
        await fetch('/api/tenant/switch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: event.target.value }),
        })
        router.refresh()
      }}
    >
      {tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
      ))}
    </select>
  )
}
```

Append to `app/globals.css`:

```css
.tenant-switcher {
  background: var(--panel); color: var(--ink); border: 1px solid var(--line);
  border-radius: 8px; padding: 6px 10px; font-size: 13px; font-family: inherit;
}
```

- [ ] **Step 7: Read the active tenant cookie in the session bridge**

In `lib/server/tenant-session.ts`, replace the `requireTenantContext` signature so it reads the cookie itself rather than taking a caller-supplied id:

```ts
import { cookies } from 'next/headers'

export async function requireTenantContext(): Promise<Readonly<TenantContext>> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) throw new UnauthenticatedError()
  const store = await cookies()
  const activeTenantId = store.get('helm_active_tenant')?.value
  const membership = await resolveMembership(email, activeTenantId)
  if (!membership) throw new NoMembershipError(email)
  return createTenantContext({
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role,
    scopes: scopesForRole(membership.role),
  })
}
```

The cookie is only honoured for platform admins — `resolveMembership` already ignores `activeTenantId` unless `is_platform_admin` is true, so a forged cookie cannot move a normal user into another tenant.

- [ ] **Step 8: Run tests and commit**

Run: `npm test`
Expected: PASS — the existing `shell.test.tsx` and `theme.test.tsx` must still pass, since `TenantProvider` keeps its default behaviour when no value is given.

```bash
git add lib/tenant.tsx "app/(app)/layout.tsx" components/shell/TenantSwitcher.tsx app/api/tenant/switch lib/server/tenant-session.ts app/globals.css test/tenant-provider.test.tsx
git commit -m "feat(shell): platform-admin tenant switcher with cookie-scoped context"
```

---

## Task 11: The cutover — swap lib/data onto repositories

**Files:**
- Modify: `lib/data/index.ts`
- Test: `test/data-cutover.test.ts`

**Interfaces:**
- Consumes: every repository from Tasks 6–7; `requireTenantContext` (Task 8); `withTenantContext` (Task 1)
- Produces: `lib/data` keeps every existing export signature; adds `getCurrentTenantValue(): Promise<TenantValue | undefined>` and `decideApprovalAction(externalRef, decision): Promise<void>`

**Critical:** `test/data.test.ts` and `test/operate-data.test.ts` assert on data *content* — channel checkups summing to the funnel stage, exactly 3 approvals, 8 agents, a 14-point series. Those tests must keep passing. That is the cutover invariant from spec §6.

- [ ] **Step 1: Write the failing test**

Create `test/data-cutover.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as data from '@/lib/data'

describe('data layer cutover', () => {
  it('falls back to fixtures when no database is configured', async () => {
    delete process.env.NEON_DATABASE_URL
    const campaigns = await data.getCampaignsFull()
    expect(campaigns.length).toBe(8)
    expect(campaigns[0]).toHaveProperty('channelColor')
  })

  it('keeps every campaign shape the UI relies on', async () => {
    const [campaign] = await data.getCampaignsFull()
    for (const key of ['id', 'name', 'channel', 'channelColor', 'status', 'spend', 'budget', 'pacingPct', 'results', 'cac', 'roas', 'objective', 'startedAt']) {
      expect(campaign).toHaveProperty(key)
    }
  })

  it('exposes a tenant value resolver for the shell', async () => {
    expect(typeof data.getCurrentTenantValue).toBe('function')
  })
})

describe('fallback classification', () => {
  it('treats missing config and unauthenticated callers as expected', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('Missing required server environment variable: databaseUrl'))).toBe(true)
    expect(isExpectedFallback(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true)
    class UnauthenticatedError extends Error {}
    expect(isExpectedFallback(new UnauthenticatedError('nope'))).toBe(true)
  })

  it('does NOT swallow a genuine query bug', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('column "spend_minor" does not exist'))).toBe(false)
    expect(isExpectedFallback(new Error('syntax error at or near "slect"'))).toBe(false)
  })
})
```

`isExpectedFallback` must be exported from `lib/data/index.ts` so this test can reach it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- data-cutover`
Expected: FAIL — `data.getCurrentTenantValue` is not a function.

- [ ] **Step 3: Add the read helper and swap the campaign functions**

Replace `lib/data/index.ts` with:

```ts
import * as fx from './mock/fixtures'
import type * as T from '../types'
import type { TenantValue } from '../tenant'

const delay = <V>(v: V): Promise<V> => Promise.resolve(v)

/**
 * True for the two conditions that legitimately mean "no database here":
 * an unconfigured/unreachable Neon connection, and an unauthenticated or
 * unprovisioned caller. Anything else is a real bug and must stay visible.
 */
export function isExpectedFallback(error: unknown): boolean {
  const name = error instanceof Error ? error.constructor.name : ''
  if (name === 'UnauthenticatedError' || name === 'NoMembershipError') return true
  const message = error instanceof Error ? error.message : ''
  return /Missing required server environment variable|ECONNREFUSED|ENOTFOUND|password authentication failed/i.test(message)
}

/**
 * Runs a repository read under tenant RLS, falling back to fixtures when no
 * database is configured or the caller has no session. The fallback is what
 * keeps tests and local development working without Neon.
 *
 * A genuine query bug must never be silently indistinguishable from "no
 * database": unexpected errors are logged, and in production they throw.
 */
async function read<V>(work: (tx: import('../server/tenant-context').TenantQueryTransaction) => Promise<V>, fallback: V): Promise<V> {
  if (!process.env.NEON_DATABASE_URL) return fallback
  try {
    const { requireTenantContext } = await import('../server/tenant-session')
    const { withTenantContext } = await import('../server/db')
    const context = await requireTenantContext()
    return await withTenantContext(context, work)
  } catch (error) {
    if (isExpectedFallback(error)) return fallback
    console.error('[data] repository read failed, serving fixtures', error)
    if (process.env.HELM_ENV === 'production') throw error
    return fallback
  }
}

export const getTenant = () => delay<T.Tenant>(fx.tenant)
export const getKpis = () => delay<T.KpiMetric[]>(fx.kpis)
export const getMetricStrip = () => delay<T.MetricCell[]>(fx.metricStrip)
export const getAnalyticsPanels = () => delay<T.AnalyticsPanels>(fx.analyticsPanels)
export const getFunnel = () => delay<T.FunnelStage[]>(fx.funnel)
export const getChannels = () => delay<T.ChannelRow[]>(fx.channels)
export const getCampaigns = () => delay<T.CampaignRow[]>(fx.campaigns)
export const getActivity = () => delay<T.ActivityEvent[]>(fx.activity)
export const getAgents = () => delay<T.Agent[]>(fx.agents)
export const getGatewayBudgets = () => delay<T.GatewayBudget[]>(fx.gatewayBudgets)
export const getRouting = () => delay<T.RoutingRow[]>(fx.routing)
export const getModelSplit = () => delay<T.ModelSplitRow[]>(fx.modelSplit)
export const getTrainingJobs = () => delay<T.TrainingJob[]>(fx.trainingJobs)
export const getPermissions = () => delay<T.PermissionRow[]>(fx.permissions)
export const getIntegrations = () => delay<T.IntegrationRow[]>(fx.integrations)
export const getGuardrails = () => delay<T.Flag[]>(fx.guardrails)
export const getFeatureFlags = () => delay<T.Flag[]>(fx.featureFlags)
export const getBriefDefaults = () => delay<T.Brief>(fx.briefDefaults)

// --- Cut over to the database, one aggregate at a time. ---

export const getUsers = async (): Promise<T.User[]> => {
  const { listUsers } = await import('../repositories/directory')
  return read((tx) => listUsers(tx), fx.users)
}

export const getCampaignsFull = async (): Promise<T.CampaignFull[]> => {
  const { listCampaigns } = await import('../repositories/campaigns')
  return read((tx) => listCampaigns(tx), fx.campaignsFull)
}

export const getCampaignDetail = async (id: string): Promise<T.CampaignDetail> => {
  const { getCampaignDetailRow } = await import('../repositories/campaigns')
  return read(async (tx) => (await getCampaignDetailRow(tx, id)) ?? fx.campaignDetail(id), fx.campaignDetail(id))
}

export const getApprovals = async (): Promise<T.ApprovalItem[]> => {
  const { listApprovals } = await import('../repositories/approvals')
  return read((tx) => listApprovals(tx), fx.approvals)
}

export const getPromptTemplates = async (): Promise<T.PromptTemplate[]> => {
  const { listPromptTemplates } = await import('../repositories/conversations')
  return read((tx) => listPromptTemplates(tx), fx.promptTemplates)
}

export const getIntegrationsFull = async (): Promise<T.IntegrationDetail[]> => {
  const { listIntegrations } = await import('../repositories/directory')
  return read((tx) => listIntegrations(tx), fx.integrationsFull)
}

export const getCurrentTenantValue = async (): Promise<TenantValue | undefined> => {
  if (!process.env.NEON_DATABASE_URL) return undefined
  try {
    const { requireTenantContext } = await import('../server/tenant-session')
    const { withTenantContext } = await import('../server/db')
    const { getTenantById } = await import('../repositories/directory')
    const { toUiRole } = await import('../server/role-mapping')
    const context = await requireTenantContext()
    return await withTenantContext(context, async (tx) => {
      const tenant = (await getTenantById(tx, context.tenantId)) ?? fx.tenant
      return { tenant, role: toUiRole(context.role) }
    })
  } catch (error) {
    if (isExpectedFallback(error)) return undefined
    console.error('[data] tenant value read failed', error)
    if (process.env.HELM_ENV === 'production') throw error
    return undefined
  }
}
```

- [ ] **Step 4: Run the content-invariant tests**

Run: `npm test -- data.test operate-data data-cutover`
Expected: PASS. `data.test.ts` asserting channel sums and 8 agents, and `operate-data.test.ts` asserting 3 approvals and a 14-point series, must both still pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all files green.

- [ ] **Step 6: Verify against the real database**

Run: `npm run dev`, sign in, open `/campaigns`.
Expected: eight campaigns identical to the fixture list. Per spec §6, **any visual difference is a bug** — the seed and the fixtures are the same data.

- [ ] **Step 7: Commit**

```bash
git add lib/data/index.ts test/data-cutover.test.ts
git commit -m "feat(data): cut lib/data over to repositories with fixture fallback"
```

---

## Task 12: RLS isolation and bypass red-team tests

**Files:**
- Create: `test/rls-isolation.test.ts`
- Create: `scripts/verify-rls.mjs`

**Interfaces:**
- Consumes: `NEON_DATABASE_URL_UNPOOLED`, `NEON_PLATFORM_READER_URL`
- Produces: a verification script proving cross-tenant reads return zero rows

This task is the security gate for the phase. It runs against a real database because RLS is the behaviour under test — a mock proves nothing here.

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-rls.mjs`:

```js
import nextEnv from '@next/env'
import { Pool } from '@neondatabase/serverless'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL_UNPOOLED })
const client = await pool.connect()
let failures = 0

const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

try {
  const tenants = await client.query('select id, slug from tenants order by created_at')
  if (tenants.rows.length < 2) {
    await client.query(
      "insert into tenants (slug, name) values ('rls-probe', 'RLS Probe') on conflict (slug) do nothing",
    )
  }
  const all = await client.query('select id, slug from tenants order by created_at')
  const [a, b] = all.rows
  console.log(`Tenant A=${a.slug} B=${b.slug}`)

  const TABLES = ['campaigns', 'ad_groups', 'campaign_metrics', 'creatives',
                  'approvals', 'conversations', 'messages', 'prompt_templates', 'users', 'integrations']

  for (const table of TABLES) {
    await client.query('begin')
    await client.query("select set_config('app.tenant_id', $1, true)", [b.id])
    const leaked = await client.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [a.id])
    await client.query('commit')
    check(`${table}: tenant B cannot read tenant A rows`, leaked.rows[0].n === 0)
  }

  await client.query('begin')
  await client.query("select set_config('app.tenant_id', '', true)")
  const empty = await client.query('select count(*)::int as n from campaigns')
  await client.query('commit')
  check('empty tenant context returns zero rows (fail closed)', empty.rows[0].n === 0)
} finally {
  client.release()
  await pool.end()
}

if (failures > 0) {
  console.error(`\n${failures} RLS check(s) FAILED — do not ship.`)
  process.exit(1)
}
console.log('\nAll RLS checks passed.')
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:

```json
    "db:verify-rls": "node scripts/verify-rls.mjs",
```

- [ ] **Step 3: Run the verification**

Run: `npm run db:verify-rls`
Expected: every line `PASS`, ending `All RLS checks passed.` and exit code 0.

If any line reads `FAIL`, the isolation policy for that table is wrong. Stop and fix migration 0003 before continuing — this is the one failure in the plan that must never be worked around.

- [ ] **Step 4: Write the unit-level red-team test**

Create `test/rls-isolation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertReadOnlyStatement } from '@/lib/server/platform-read'

const migration = readFileSync(resolve(process.cwd(), 'db/migrations/0003_operate_core.sql'), 'utf8')
const reader = readFileSync(resolve(process.cwd(), 'db/migrations/0004_platform_reader.sql'), 'utf8')

describe('tenant isolation invariants', () => {
  it('no tenant-owned table is missing forced RLS', () => {
    const created = [...migration.matchAll(/create table (\w+) \(/g)].map((m) => m[1])
    const tenantOwned = created.filter((table) => {
      const block = migration.slice(migration.indexOf(`create table ${table} (`))
      return block.slice(0, block.indexOf(');')).includes('tenant_id')
    })
    for (const table of tenantOwned) {
      expect(migration).toContain(`alter table ${table} force row level security;`)
    }
    expect(tenantOwned.length).toBe(8)
  })

  it('the bypass role is granted select only', () => {
    expect(reader).toContain('grant select on all tables')
    expect(reader).toContain('revoke insert, update, delete, truncate')
    expect(reader).not.toMatch(/grant (insert|update|delete|all)/i)
  })

  it('the bypass path refuses anything that is not a read', () => {
    expect(() => assertReadOnlyStatement('select * from campaigns')).not.toThrow()
    expect(() => assertReadOnlyStatement('update campaigns set spend_minor = 0')).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 3 new tests, everything green.

- [ ] **Step 6: Commit**

```bash
git add test/rls-isolation.test.ts scripts/verify-rls.mjs package.json
git commit -m "test(security): RLS isolation verification and bypass red-team tests"
```

---

## Task 13: Wire approval decisions to real writes

**Files:**
- Create: `app/(app)/approvals/actions.ts`
- Modify: `app/(app)/approvals/ApprovalsView.tsx`
- Test: `test/approvals-action.test.ts`

**Interfaces:**
- Consumes: `decideApproval` (Task 7); `requireTenantContext` (Task 8); `withTenantContext` (Task 1)
- Produces: server action `submitApprovalDecision(externalRef: string, decision: 'approved' | 'rejected'): Promise<{ ok: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `test/approvals-action.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'app/(app)/approvals/actions.ts'), 'utf8')

describe('approval decision action', () => {
  it('is a server action', () => {
    expect(source).toMatch(/^'use server'/m)
  })

  it('derives the tenant from the session, never from an argument', () => {
    expect(source).toContain('requireTenantContext')
    expect(source).not.toMatch(/tenantId\s*:\s*(input|params|args)/)
  })

  it('only accepts the two valid decisions', () => {
    expect(source).toMatch(/approved|rejected/)
    expect(source).toContain('Invalid decision')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- approvals-action`
Expected: FAIL — `ENOENT` on `actions.ts`.

- [ ] **Step 3: Write the server action**

Create `app/(app)/approvals/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { withTenantContext } from '@/lib/server/db'
import { requireTenantContext } from '@/lib/server/tenant-session'
import { decideApproval } from '@/lib/repositories/approvals'

const VALID = new Set(['approved', 'rejected'])

export async function submitApprovalDecision(
  externalRef: string,
  decision: 'approved' | 'rejected',
): Promise<{ ok: boolean }> {
  if (!VALID.has(decision)) throw new Error('Invalid decision')
  if (!process.env.NEON_DATABASE_URL) return { ok: true }

  const context = await requireTenantContext()
  if (!context.scopes.includes('approvals.decide')) {
    throw new Error('Missing required scope: approvals.decide')
  }

  await withTenantContext(context, (tx) => decideApproval(tx, context, { externalRef, decision }))
  revalidatePath('/approvals')
  return { ok: true }
}
```

- [ ] **Step 4: Call it from the view**

In `app/(app)/approvals/ApprovalsView.tsx`, import the action and invoke it inside the existing decision handler, keeping the current optimistic UI update so the existing `approvals-view.test.tsx` and `approvals-badge.test.tsx` keep passing:

```tsx
import { submitApprovalDecision } from './actions'
```

In the handler that currently records a decision locally, add the persistence call after the local state update:

```tsx
void submitApprovalDecision(item.id, decision === 'approve' ? 'approved' : 'rejected')
```

Read the existing handler first and match its parameter names — do not restructure the component.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 3 new tests; `approvals-view.test.tsx` and `approvals-badge.test.tsx` still green.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/approvals/actions.ts" "app/(app)/approvals/ApprovalsView.tsx" test/approvals-action.test.ts
git commit -m "feat(approvals): persist decisions as audited status transitions"
```

---

## Task 14: Phase A verification and documentation

**Files:**
- Modify: `helm-app/docs/foundations.md`
- Modify: `docs/superpowers/followups.md`

- [ ] **Step 1: Run every gate**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run db:verify-rls
```

Expected: all pass. `npm test` must report at least 22 pre-existing files green plus the new ones. Record the actual numbers; do not claim success without reading the output.

- [ ] **Step 2: Manual walkthrough**

Run `npm run dev` and verify each item:

- `/analytics` while signed out redirects to `/login`.
- Signing in with Google lands on `/analytics`.
- `/campaigns` lists the eight seeded campaigns; opening a drawer shows ad groups and creatives.
- `/approvals` shows three pending items; approving one removes it from Pending and the sidebar badge decrements.
- Re-running `npm run db:seed` does not duplicate rows.

- [ ] **Step 3: Update foundations documentation**

Append to `helm-app/docs/foundations.md`:

```markdown
## Operate core (Phase A)

Migration `0003_operate_core.sql` adds campaigns, ad groups, campaign metrics, creatives,
approvals, conversations, messages, prompt templates and platform admins. Every tenant-owned
table has row-level security enabled **and forced**, with an isolation policy using
`helm_tenant_id()`. Money is stored as integer minor units in `_minor` columns; `roas` is stored
in hundredths.

`0004_platform_reader.sql` creates `helm_platform_reader`, an RLS-bypassing role granted SELECT
only. It is reachable exclusively through `withPlatformReadContext` in
`lib/server/platform-read.ts`, which rejects any statement that is not a read and writes an audit
event for every invocation. The application's normal pool must never use this connection string.

Repositories in `lib/repositories/` accept a `TenantQueryTransaction` that already has RLS context
established. They never open connections and never read a session, so tenant scoping cannot be
forgotten by a caller.

`lib/data/index.ts` reads through repositories when `NEON_DATABASE_URL` is set and falls back to
`lib/data/mock/fixtures.ts` otherwise. The fixtures are also the seed source, so seeded rows and
fixtures are the same data — any visual difference between the two paths is a bug.

Run `npm run db:verify-rls` after any migration touching a tenant-owned table.
```

- [ ] **Step 4: Update the followups backlog**

In `docs/superpowers/followups.md`, add under the Operate surfaces section:

```markdown
### Made cheaper by Phase A (still open)
- Item 6 (drawer chart): `campaign_metrics` now supplies a real 14-point series through
  `getCampaignDetail().series`. The drawer still renders the static decorative chart.
- Item 1 (Approvals edit): `approvals.payload` is now a jsonb column holding the editable
  payload, so an inline editor has real data to write back to.
```

- [ ] **Step 5: Commit**

```bash
git add helm-app/docs/foundations.md docs/superpowers/followups.md
git commit -m "docs: Phase A operate core, platform reader and repository contracts"
```

---

## Definition of Done

- [ ] Signing in with Google lands on `/analytics`; signed-out requests redirect to `/login`.
- [ ] Campaigns, Studio, Approvals, Workspace, Integrations and RBAC read tenant-scoped rows from Neon.
- [ ] Approving an item writes a status transition and an `audit_log` row; nothing is deleted.
- [ ] `npm run db:verify-rls` passes every check, including the fail-closed empty-context case.
- [ ] The cross-tenant read path rejects every non-select statement and audits each invocation.
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.
- [ ] The 47 pre-existing tests are still green.

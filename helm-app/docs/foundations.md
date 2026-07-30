# HELM Foundations

## Database deployment

1. Create a Neon Postgres project in the approved residency region.
2. Set `NEON_DATABASE_URL` (pooled) and `NEON_DATABASE_URL_UNPOOLED` (migration-only) in each environment; do not commit either value.
3. Apply migrations, including `db/migrations/0001_foundations.sql`, using the privileged migration role (`neondb_owner`, via `NEON_DATABASE_URL_UNPOOLED`).
4. Use a runtime database role that cannot bypass RLS. Every tenant-owned request must call `establishTenantContext` within its transaction before querying.

### The `helm_app` role is mandatory -- do not connect the app as an owner role

`neondb_owner` (and any other role with `rolbypassrls = true`, including
superusers) **ignores row-level security policies entirely**, regardless of
whether those policies are enabled, forced, and correctly written. This is
not a theoretical risk: during Phase A, the app's connection was verified
against the live Neon database to leak tenant A's rows into a query issued
under tenant B's context, purely because it connected as `neondb_owner`.
Every RLS policy from migrations 0001 and 0003 was present and correct --
they were simply inert against a bypassing role.

`db/migrations/0005_app_role.sql` creates `helm_app`, a role with
`nobypassrls` explicitly set, granted `select, insert, update, delete` (no
DDL, no truncate) on all application tables, including future ones via
`alter default privileges`. This is the **only** role the application's
connection pool (`NEON_DATABASE_URL`) may use at runtime.

- `neondb_owner` via `NEON_DATABASE_URL_UNPOOLED` -- migrations only. Never
  wire this into the app's runtime connection pool.
- `helm_app` via `NEON_DATABASE_URL` -- the app's runtime connection. RLS
  applies unconditionally.
- `helm_platform_reader` via `NEON_PLATFORM_READER_URL` -- read-only,
  bypasses RLS deliberately, used solely by the audited cross-tenant
  platform-admin read path in `lib/server/platform-read.ts`. Never used for
  ordinary tenant-scoped queries.

The migration does not set `helm_app`'s password (no migration file may
contain a credential). Run `npm run db:provision-app-role` once per
environment, supplying a high-entropy password via the
`HELM_APP_ROLE_PASSWORD` environment variable, to set it and print a masked
connection string. Put the real value in `NEON_DATABASE_URL` in
`.env.local` for local dev and in Vercel env for every deployed
environment.

If you are setting up a new environment or reviewing this code, verify
`NEON_DATABASE_URL` authenticates as `helm_app`, not `neondb_owner`.

**A boot-time guard now enforces this in code, not just in documentation.**
`assertRuntimeRoleCannotBypassRls` (`lib/server/db.ts`) runs once per process,
before the first tenant-scoped query: it queries
`pg_roles.rolbypassrls` for `current_user` and throws a `RlsBypassError` if
the connecting role can bypass RLS. `lib/data`'s `read()` wrapper treats
`RlsBypassError` as fail-loud in every environment -- it is never caught into
the fixture fallback the way a genuine "no database configured" condition is.
This means: if `NEON_DATABASE_URL` is accidentally repointed at `neondb_owner`
(or any other bypassing role), tenant-scoped reads and writes refuse to run at
all rather than silently serving unfiltered cross-tenant data. `GET
/api/health`'s plain connectivity probe does not go through
`withTenantContext` and will still report `connected: true` for a bypassing
role -- health-check green does not mean the tenant-isolation guard is
satisfied; only actually exercising a tenant-scoped read/write does.

After deployment, `GET /api/health` checks whether the server can reach Neon. It returns no credential or database content.

### Migrations 0006-0008: closing gaps found while hardening the role split

- **`0006_default_privileges_for_role.sql`** -- `alter default privileges`
  only governs objects later created by the exact role named in its `for
  role` clause (or, if omitted, whichever role happens to execute the
  `alter default privileges` statement itself). 0004 and 0005 issued that
  grant without `for role`, so it was scoped to `neondb_owner` only because
  that happened to be the role running migrations at the time -- correct by
  coincidence, not by guarantee. 0006 reissues both default-privilege rules
  (`select` for `helm_platform_reader`, `select/insert/update/delete` for
  `helm_app`) with an explicit `for role neondb_owner`, so future tables
  created by the migration role are guaranteed covered.
- **`0007_membership_lookup.sql`** -- creates `helm_lookup_membership(email)`,
  a `SECURITY DEFINER` function. Login must resolve identity (which tenant a
  user belongs to) *before* any tenant context exists, but `users` has forced
  RLS keyed on `helm_tenant_id()`, which returns `NULL` until a tenant
  context is set -- an ordinary `select` from `users` issued by `helm_app`
  before a context exists always returns zero rows, for any email, making
  login permanently impossible. `helm_lookup_membership` runs with its
  owner's (bypassrls-capable) privileges but only ever exposes a single
  parameterised, narrowly-shaped result -- exact email match, active users
  only -- so it is the one intentional, audited exception to "no query runs
  without RLS," not a general bypass. `execute` is revoked from `public` and
  granted only to `helm_app`.
- **`0008_membership_lookup_all.sql`** -- fixes an unsoundness in 0007's
  version of the function: it returned at most one row via an unordered
  `limit 1`, but `users` is unique on `(tenant_id, email)`, not globally
  unique on email -- the schema deliberately allows one person to hold
  memberships (with different roles) in multiple tenants. Proved live:
  seeding the same email into two tenants with different roles showed the
  winning row was plan-dependent and could flip silently between calls, which
  is a silent privilege change, not a performance detail. 0008 redefines the
  function to return **all** active memberships for the email, deterministically
  ordered (`order by t.created_at asc, u.id asc`), filtered to active tenants
  as well as active users, and leaves the choice among multiple memberships to
  explicit, auditable application logic (`resolveMembership` in
  `lib/server/tenant-session.ts`) rather than an implicit database pick.

## Auth integration contract

Auth.js is configured with optional Google and Microsoft Entra OAuth providers. Set one provider's credentials plus `AUTH_SECRET` in `.env.local` before exposing login. The server validates a session, loads the matching tenant membership, and constructs `TenantContext` using `createTenantContext`. Browser-supplied tenant IDs and roles are never trusted.

## Audit contract

Use `appendAuditEvent` for human, system, and agent actions. `audit_log` cannot be updated or deleted; amendments are new events.

## Model Gateway contract

`lib/gateway` routes logical tasks to configured provider adapters only after tenant policy validation. Provider keys and SDK clients remain server-only; no client component may import a gateway adapter.

Migration `0002_model_gateway.sql` adds tenant-specific gateway policy and immutable usage metering. The migration runner records applied files in `schema_migrations` and safely baselines the already-applied first migration.

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
fixtures are the same data -- any visual difference between the two paths is a bug.

### `lib/data` is server-only; client components go through server actions

Everything under `lib/data` and `lib/repositories` is marked `import 'server-only'` and can only
run in a server context -- it is not reachable from a client component's module graph at all, by
build-time enforcement, not just convention. Client components that need repository-backed data
(the campaigns list/drawer, the approvals queue) call into it indirectly through `'use server'`
actions: `app/(app)/campaigns/actions.ts` and `app/(app)/approvals/actions.ts`. Approving or
editing in the UI goes through the approvals action, which writes an audited status transition
(never a delete) via `appendAuditEvent`.

### Error classification in the data layer

`lib/data/index.ts`'s `read()` wrapper (and `getCurrentTenantValue`) classify every error a
repository read can throw, in this order:

1. **Next.js control-flow signals** (`DYNAMIC_SERVER_USAGE`, `NEXT_REDIRECT`) are re-thrown
   untouched, before any other check -- swallowing these breaks routing/prerendering.
2. **`RlsBypassError`** (the connecting role can bypass RLS) always re-throws, in every
   environment. This must never be masked by a plausible-looking fixture response.
3. **Auth failures** (Postgres SQLSTATE `28P01`/`28000`, i.e. rejected credentials) always
   re-throw, in every environment, for the same reason.
4. **`DatabaseUnreachableError`** (connection refused, DNS/TLS failure, timeout, or a dropped
   socket -- classified at the connection boundary in `lib/server/db.ts`, not by sniffing an
   arbitrary downstream error shape) and unauthenticated/unprovisioned-session errors fall back to
   fixtures, with a single warn-level log line.
5. Anything else is an **unexpected error**: logged at error level, and re-thrown in production
   (`HELM_ENV=production` or `NODE_ENV=production`) so a genuine bug never looks like "no database
   configured." Outside production it falls back to fixtures so local development degrades
   gracefully.

Run `npm run db:verify-rls` after any migration touching a tenant-owned table. The script itself
refuses to run its checks through a bypassing role: before any isolation check, it queries
`pg_roles.rolbypassrls` for the role under test and exits fatally if it is not `false` --
otherwise every PASS below that point would be meaningless (a bypassing connection sees every row
regardless of policy correctness). If `NEON_APP_DATABASE_URL` is not set, it provisions a
throwaway `nobypassrls` probe role scoped to the same privileges as `helm_app`, runs every check
through that role, and drops it afterward.

## Phase A: what's done and what's pending

Phase A (auth + tenant-scoped data spine) is implemented and its own gates are green: `npm test`,
`npm run lint` (pre-existing errors aside, see below), `npx tsc --noEmit`, `npm run build`, and
`npm run db:verify-rls` all pass. Three items remain genuinely open, not implemented, and not
worked around:

- **OAuth credentials are not configured in this workspace.** `.env.local` has no
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (or Entra equivalents). Sign-in cannot be exercised end to
  end locally until a real OAuth app is provisioned and its credentials are added to `.env.local`.
  Everything downstream of a real session -- `/campaigns` rendering seeded rows in a browser tab,
  approving an item in the UI -- is blocked on this, not on any code defect.
- **`NEON_DATABASE_URL` still points at `neondb_owner`, not `helm_app`.** This is deliberately
  refused at runtime by the boot guard described above (`assertRuntimeRoleCannotBypassRls`):
  tenant-scoped reads/writes throw `RlsBypassError` rather than silently leaking data, so the app
  will not serve real tenant data locally until the connection string is repointed. To fix:
  provision `helm_app`'s password with `npm run db:provision-app-role` (supplying
  `HELM_APP_ROLE_PASSWORD`), then put the resulting connection string in `NEON_DATABASE_URL` in
  `.env.local`. `NEON_DATABASE_URL_UNPOOLED` should stay pointed at `neondb_owner` -- migrations
  and `db:verify-rls`'s owner-role fixture setup need it.
- **A stray `probe-t` tenant exists in the shared dev database** from an early ad hoc RLS probe
  (predates this task). It cannot be deleted: `audit_log` rows reference it and `audit_log` is
  append-only (insert/update/delete are all rejected by trigger, by design). It is harmless --
  RLS isolates it like any other tenant -- but it will appear in tenant-switcher lists for
  platform admins in this environment. The only way to remove it is to recreate the database.

Two pre-existing lint errors (`StudioView.tsx`'s `Math.random` in render, `WorkspaceView.tsx`'s
two unescaped apostrophes) are present on `main` and unrelated to Phase A; this phase's branch
does not touch either file and does not fix them.

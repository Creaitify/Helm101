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
`NEON_DATABASE_URL` authenticates as `helm_app`, not `neondb_owner`. There
is no automated guard against a misconfigured connection string pointing at
an owner role -- treat this as an explicit deployment checklist item, not
an assumption.

After deployment, `GET /api/health` checks whether the server can reach Neon. It returns no credential or database content.

## Auth integration contract

Auth.js is configured with optional Google and Microsoft Entra OAuth providers. Set one provider's credentials plus `AUTH_SECRET` in `.env.local` before exposing login. The server validates a session, loads the matching tenant membership, and constructs `TenantContext` using `createTenantContext`. Browser-supplied tenant IDs and roles are never trusted.

## Audit contract

Use `appendAuditEvent` for human, system, and agent actions. `audit_log` cannot be updated or deleted; amendments are new events.

## Model Gateway contract

`lib/gateway` routes logical tasks to configured provider adapters only after tenant policy validation. Provider keys and SDK clients remain server-only; no client component may import a gateway adapter.

Migration `0002_model_gateway.sql` adds tenant-specific gateway policy and immutable usage metering. The migration runner records applied files in `schema_migrations` and safely baselines the already-applied first migration.

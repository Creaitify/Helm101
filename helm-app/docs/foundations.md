# HELM Foundations

## Database deployment

1. Create a Neon Postgres project in the approved residency region.
2. Set `NEON_DATABASE_URL` (pooled) and `NEON_DATABASE_URL_UNPOOLED` (migration-only) in each environment; do not commit either value.
3. Apply `db/migrations/0001_foundations.sql` using a privileged migration role.
4. Use a runtime database role that cannot bypass RLS. Every tenant-owned request must call `establishTenantContext` within its transaction before querying.

After deployment, `GET /api/health` checks whether the server can reach Neon. It returns no credential or database content.

## Auth integration contract

Auth.js is configured with optional Google and Microsoft Entra OAuth providers. Set one provider's credentials plus `AUTH_SECRET` in `.env.local` before exposing login. The server validates a session, loads the matching tenant membership, and constructs `TenantContext` using `createTenantContext`. Browser-supplied tenant IDs and roles are never trusted.

## Audit contract

Use `appendAuditEvent` for human, system, and agent actions. `audit_log` cannot be updated or deleted; amendments are new events.

## Model Gateway contract

`lib/gateway` routes logical tasks to configured provider adapters only after tenant policy validation. Provider keys and SDK clients remain server-only; no client component may import a gateway adapter.

Migration `0002_model_gateway.sql` adds tenant-specific gateway policy and immutable usage metering. The migration runner records applied files in `schema_migrations` and safely baselines the already-applied first migration.

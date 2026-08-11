# HELM Database Migration Ownership

## Decision

`api/alembic/` is the canonical — and since the 2026-08 consolidation, the only — migration mechanism. It owns the HELM schema and uses only `DATABASE_MIGRATION_URL`, an unpooled privileged migration connection. Application code uses the separate pooled `DATABASE_URL` and cannot run schema changes.

The production `users` table is deliberately global: it represents an immutable external identity and is linked to tenants only through `tenant_memberships`. It does not receive tenant RLS because no single tenant owns a global identity. FastAPI may access it only through controlled identity repositories; frontend/BFF clients, unscoped sessions, and general-purpose tenant repositories must never query it directly.

## Provisioning and timestamp boundaries

Forced RLS deliberately means a normal tenant-scoped application session cannot create a new tenant: it has no existing tenant context through which it can authorize the new tenant row. Tenant provisioning therefore requires a separate privileged, tightly controlled, audited provisioning path. That path is a future implementation and is not a general API or repository bypass.

The foundation uses a PostgreSQL `set_foundation_updated_at` trigger for the mutable tables (`tenants`, global `users`, and `tenant_memberships`) so `updated_at` remains correct regardless of which controlled repository changes a row. `audit_log` intentionally has only `created_at`: it is append-only and database-level update/delete rejection makes an `updated_at` trigger inappropriate.

## Prototype migration history (resolved 2026-08-11)

The Next.js prototype's second migration runner (`helm-app/db/migrations/`, SQL files 0001–0008) and everything that read its schema were deleted in the consolidation cleanup — its email-keyed direct-user-to-tenant model was incompatible with the canonical global `users` plus `tenant_memberships` model, and running two migration runners against one schema risked incompatible tables, duplicate enum/function names, conflicting RLS policies, and contradictory history. That risk is now structural history rather than an active constraint: exactly one runner exists.

## Existing-data transition

If any data in a still-running prototype `neondb` instance must be retained, create an explicit one-time ownership and data-migration plan before touching the canonical schema: inventory, mapping/compatibility review, backup and rollback strategy, rehearsal on an isolated environment, approval, and a controlled cutover. Otherwise decommission the instance — its identity-lookup function predates the `pg_temp` search-path hardening (see `docs/PENDING.md`).

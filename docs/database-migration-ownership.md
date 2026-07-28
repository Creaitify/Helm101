# HELM Database Migration Ownership

## Decision

`helm-api/alembic/` is the canonical migration mechanism for the production Python/FastAPI backend. It owns the future HELM backend schema and uses only `DATABASE_MIGRATION_URL`, an unpooled privileged migration connection. Application code uses the separate pooled `DATABASE_URL` and cannot run schema changes.

The production `users` table is deliberately global: it represents an immutable external identity and is linked to tenants only through `tenant_memberships`. It does not receive tenant RLS because no single tenant owns a global identity. FastAPI may access it only through controlled identity repositories; frontend/BFF clients, unscoped sessions, and general-purpose tenant repositories must never query it directly.

## Provisioning and timestamp boundaries

Forced RLS deliberately means a normal tenant-scoped application session cannot create a new tenant: it has no existing tenant context through which it can authorize the new tenant row. Tenant provisioning therefore requires a separate privileged, tightly controlled, audited provisioning path. That path is a future implementation and is not a general API or repository bypass.

The foundation uses a PostgreSQL `set_foundation_updated_at` trigger for the mutable tables (`tenants`, global `users`, and `tenant_memberships`) so `updated_at` remains correct regardless of which controlled repository changes a row. `audit_log` intentionally has only `created_at`: it is append-only and database-level update/delete rejection makes an `updated_at` trigger inappropriate.

## Prototype migration conflict risk

`helm-app/db/migrations/` belongs to the existing Next.js prototype. Its direct-user-to-tenant schema and migration runner are not compatible with the production global `users` plus `tenant_memberships` model. The prototype migrations must not run against the same database/schema as Alembic. Parallel migration runners can create incompatible tables, duplicate enum/function names, conflicting RLS policies, or contradictory migration history.

## Existing-data transition

If any prototype database data must be retained, the team must create an explicit one-time ownership and data-migration plan before either system targets the same schema. That plan requires an inventory, mapping/compatibility review, backup and rollback strategy, a rehearsal on an isolated environment, approval, and a controlled cutover. No destructive Alembic migration may be generated or applied as a substitute for that plan.

-- Runtime application role: the ONLY role the app's connection pool may use.
--
-- Why this role exists: `neondb_owner` (used by migrations) has
-- `rolbypassrls = true`. Postgres row-level security is unconditionally
-- ignored by any role with `rolbypassrls`, regardless of how correct the
-- policies are. Migrations 0001 and 0003 create tenant isolation policies
-- that are enabled AND forced on every tenant-owned table, but if the
-- application connects as `neondb_owner` (or any other bypassrls/superuser
-- role), every one of those policies is silently inert -- tenant A's rows
-- become readable and writable from tenant B's context. This was verified
-- against the live database during Phase A: with `neondb_owner`, a query
-- issued under tenant B's context returned tenant A's campaigns row.
--
-- `helm_app` has `nobypassrls` explicitly. The application must connect
-- using this role's credentials (`NEON_DATABASE_URL`) for all tenant-owned
-- queries. `neondb_owner` remains migration-only
-- (`NEON_DATABASE_URL_UNPOOLED`) and must never be used as the app's
-- runtime connection.
--
-- This migration does NOT set a password. Passwords are provisioned
-- out-of-band via `npm run db:provision-app-role` (scripts/provision-app-role.mjs),
-- which reads HELM_APP_ROLE_PASSWORD from the environment and issues the
-- ALTER ROLE directly -- no secret is ever written to a migration file.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'helm_app') then
    create role helm_app login nobypassrls;
  end if;
end
$$;

grant usage on schema public to helm_app;
grant select, insert, update, delete on all tables in schema public to helm_app;
alter default privileges in schema public grant select, insert, update, delete on tables to helm_app;

revoke truncate on all tables in schema public from helm_app;

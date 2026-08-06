-- SUPERSEDED by 0008_membership_lookup_all.sql, which replaces
-- helm_lookup_membership to return ALL of the caller's active memberships
-- (not just one, via `limit 1` below) so a user with roles in more than one
-- tenant can be handled correctly. Do not trust the `limit 1` version below
-- in isolation -- read 0008 for the function actually in effect.
--
-- Identity must be resolved BEFORE a tenant context can exist, but users has
-- forced RLS keyed on app.tenant_id. This SECURITY DEFINER function is the one
-- narrow, parameterised exception: it returns at most one membership row for a
-- single email and exposes nothing else. RLS remains enforced for all other access.
--
-- Proven necessary: `users` has `force row level security` with policy
-- `tenant_id = helm_tenant_id()`, and `helm_tenant_id()` returns NULL until
-- `app.tenant_id` is set via `set_config`. A direct `select ... from users`
-- issued by `helm_app` (nobypassrls, required for all app traffic per
-- 0005_app_role.sql) before a tenant context exists always returns zero rows,
-- for every email -- login would be permanently broken. This function is
-- SECURITY DEFINER so it runs with the privileges of its owner (a bypassrls-
-- capable migration role), letting it see all tenants' users, but it only
-- ever returns a single row selected by exact email match -- it does not
-- widen access to the table itself.
--
-- `set search_path = public, pg_temp` -- pg_temp is named EXPLICITLY and must
-- stay LAST. Postgres searches the session's temp schema implicitly FIRST,
-- ahead of everything written in search_path, unless pg_temp is named, in
-- which case it sits exactly where written. pg_temp is writable by PUBLIC, so
-- under the previous `set search_path = public` any role with EXECUTE here
-- could `create temp table users (...)`, insert a row naming any user_id /
-- tenant_id it liked with role 'owner', and call this function: the body's
-- `users` would bind to that temp table while the joins against the real
-- `tenants` and `platform_admins` ran with the owner's privileges. The caller
-- treats the result as authoritative identity, so that is tenant, role, and
-- (via a fabricated user_id present in platform_admins) is_platform_admin all
-- chosen by the attacker. Naming pg_temp last demotes it from
-- implicitly-first to explicitly-last, so real `public` tables win resolution.
--
-- This is hardened even though 0007 is SUPERSEDED: scripts/migrate.mjs replays
-- every unapplied .sql in sorted order, each in its own transaction, so a
-- fresh database commits THIS function -- with EXECUTE already granted to
-- helm_app -- and lives with it for the window between 0007 and 0008. A
-- vulnerable function that exists only briefly is still a vulnerable function
-- that was granted out.
create or replace function helm_lookup_membership(p_email text)
returns table (
  user_id uuid,
  tenant_id uuid,
  tenant_slug text,
  role helm_role,
  is_platform_admin boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select u.id, u.tenant_id, t.slug, u.role, (pa.user_id is not null)
  from users u
  join tenants t on t.id = u.tenant_id
  left join platform_admins pa on pa.user_id = u.id
  where lower(u.email) = lower(p_email)
    and u.status = 'active'
  limit 1;
$$;

revoke all on function helm_lookup_membership(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'helm_app') then
    grant execute on function helm_lookup_membership(text) to helm_app;
  end if;
end
$$;

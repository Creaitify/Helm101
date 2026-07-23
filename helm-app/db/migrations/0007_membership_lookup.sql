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
set search_path = public
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

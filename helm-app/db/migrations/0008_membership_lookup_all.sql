-- helm_lookup_membership (0007) returned at most one row via an unordered
-- `limit 1`. That is unsound: `users` is `unique (tenant_id, email)`, NOT
-- globally unique on email -- the schema deliberately allows the same person
-- to hold memberships in several tenants, each with a potentially different
-- role. Proved live: seeding one email into two tenants with different roles
-- ("client_viewer" in one, "owner" in another) showed the old function's
-- winner was plan-dependent across repeated calls with no ORDER BY -- tenant,
-- role, AND is_platform_admin could all silently flip. Picking one row
-- arbitrarily is a silent privilege change, not a performance detail.
--
-- Fix: return ALL active memberships for the email, deterministically
-- ordered (`order by t.created_at asc, u.id asc`, a total order since
-- `(tenant_id, email)` is unique so at most one row per tenant can match).
-- The caller (`resolveMembership` in lib/server/tenant-session.ts) selects
-- among them using explicit, auditable precedence -- it no longer relies on
-- the database to have silently chosen for it.
--
-- Also excludes non-active tenants (`t.status = 'active'`): neither this
-- function nor the tenant-switch path previously filtered `tenants.status`,
-- so a suspended or archived tenant's membership was still reachable.
--
-- `create or replace` does NOT guarantee privileges carry over from the
-- function it replaces, so `revoke`/`grant` are re-issued unconditionally
-- below rather than assumed to still hold.
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
    and t.status = 'active'
  order by t.created_at asc, u.id asc;
$$;

revoke all on function helm_lookup_membership(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'helm_app') then
    grant execute on function helm_lookup_membership(text) to helm_app;
  end if;
end
$$;

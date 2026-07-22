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

-- `alter default privileges` only applies to objects later created BY THE
-- ROLE NAMED IN `for role ...` (or, without that clause, by whichever role
-- executes this statement). Without an explicit `for role neondb_owner`,
-- this default-privileges rule would silently do nothing for tables created
-- by any other role, and a future migration applied by a different role
-- would leave its new tables ungranted to helm_platform_reader with no
-- error. Migrations must continue to be applied by `neondb_owner` (the role
-- `NEON_DATABASE_URL_UNPOOLED` authenticates as) for this clause -- and
-- therefore future tables -- to be covered.
alter default privileges for role neondb_owner in schema public grant select on tables to helm_platform_reader;

revoke insert, update, delete, truncate on all tables in schema public from helm_platform_reader;

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
alter default privileges in schema public grant select on tables to helm_platform_reader;

revoke insert, update, delete, truncate on all tables in schema public from helm_platform_reader;

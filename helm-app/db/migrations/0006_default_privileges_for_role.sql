-- Re-issues the `alter default privileges` clauses from 0004 and 0005 with an
-- explicit `for role neondb_owner`.
--
-- Why this migration exists: `alter default privileges ... grant ... to X`
-- only affects objects later created BY THE ROLE NAMED IN `for role ...` (or,
-- without that clause, by whichever role executes the ALTER DEFAULT
-- PRIVILEGES statement itself). 0004_platform_reader.sql and
-- 0005_app_role.sql were applied without `for role`, so the rule they
-- installed is scoped to whatever role happened to run `npm run db:migrate`
-- at the time (in this project, `neondb_owner`, via `NEON_DATABASE_URL_UNPOOLED`).
-- That happens to be correct today only incidentally -- there was no
-- guarantee of it, and no documentation saying migrations must always be
-- applied by that specific role for future tables to be covered.
--
-- `alter default privileges` is idempotent and additive: re-running it with
-- an explicit `for role neondb_owner` replaces the earlier (accidentally
-- role-scoped-the-same-way) rule with an equivalent one that is now
-- guaranteed correct, rather than correct-by-coincidence, and documents the
-- constraint that migrations must be applied by `neondb_owner`.
--
-- This migration does not change any existing grant on existing tables --
-- 0004 and 0005 already ran `grant select ... on all tables in schema
-- public`, which is unaffected here. This only fixes the rule that governs
-- tables created AFTER this migration runs.

alter default privileges for role neondb_owner in schema public grant select on tables to helm_platform_reader;
alter default privileges for role neondb_owner in schema public grant select, insert, update, delete on tables to helm_app;

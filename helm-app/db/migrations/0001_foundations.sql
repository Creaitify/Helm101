-- HELM foundations: shared-schema multi-tenancy with database-enforced isolation.
-- Run with a privileged migration role. Application requests must set app.tenant_id
-- through the transaction helper; never accept a tenant id from browser input.

create extension if not exists pgcrypto;

create type helm_role as enum ('owner', 'agency_admin', 'strategist', 'creative', 'analyst', 'client_viewer');
create type integration_status as enum ('healthy', 'degraded', 'paused', 'disconnected');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan text not null default 'starter',
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  email text not null,
  display_name text not null,
  role helm_role not null default 'client_viewer',
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  kind text not null,
  status integration_status not null default 'disconnected',
  scopes text[] not null default '{}',
  credential_ref text,
  health jsonb not null default '{}',
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id text not null,
  action text not null,
  target text not null,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index users_tenant_idx on users (tenant_id);
create index integrations_tenant_idx on integrations (tenant_id);
create index audit_log_tenant_occurred_idx on audit_log (tenant_id, occurred_at desc);

-- Audit rows are append-only. Corrections must be represented by a new event.
create or replace function prevent_audit_log_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function prevent_audit_log_mutation();

-- Empty or missing context deliberately returns no rows (fail closed).
create or replace function helm_tenant_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

alter table users enable row level security;
alter table integrations enable row level security;
alter table audit_log enable row level security;
alter table users force row level security;
alter table integrations force row level security;
alter table audit_log force row level security;

create policy users_tenant_isolation on users
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy integrations_tenant_isolation on integrations
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy audit_log_tenant_isolation on audit_log
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());

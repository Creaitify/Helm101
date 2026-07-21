create table tenant_model_policies (
  tenant_id uuid primary key references tenants(id) on delete restrict,
  allowed_tasks text[] not null default array['reasoning.plan', 'copy.variant', 'embed'],
  max_input_characters integer not null default 12000 check (max_input_characters between 1 and 100000),
  monthly_budget_usd numeric(12,4) not null default 0 check (monthly_budget_usd >= 0),
  autonomy_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  feature text not null,
  provider text not null,
  model text not null,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index usage_events_tenant_created_idx on usage_events (tenant_id, created_at desc);

alter table tenant_model_policies enable row level security;
alter table tenant_model_policies force row level security;
alter table usage_events enable row level security;
alter table usage_events force row level security;

create policy tenant_model_policies_isolation on tenant_model_policies
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy usage_events_isolation on usage_events
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());

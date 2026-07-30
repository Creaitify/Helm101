-- HELM operate core: the tables the existing screens already imply.
-- Every tenant-owned table repeats the 0001 pattern: tenant_id FK, RLS
-- enabled AND forced, isolation policy via helm_tenant_id().
-- Money is integer minor units (paise). Never floating point.

create type campaign_status as enum ('active', 'review', 'paused');
create type creative_kind as enum ('image', 'video', 'copy');
create type creative_status as enum ('live', 'review', 'draft');
create type compliance_verdict as enum ('pass', 'flag');
create type approval_status as enum ('pending', 'approved', 'rejected');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  external_ref text not null,
  name text not null,
  channel text not null,
  status campaign_status not null default 'review',
  objective text not null default '',
  spend_minor bigint not null default 0,
  budget_minor bigint not null default 0,
  results integer not null default 0,
  cac_minor bigint,
  roas integer not null default 0,
  started_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table ad_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  external_ref text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  spend_minor bigint not null default 0,
  results integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  metric_date date not null,
  spend_minor bigint not null default 0,
  results integer not null default 0,
  unique (campaign_id, metric_date)
);

create table creatives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  campaign_id uuid references campaigns(id) on delete set null,
  external_ref text not null,
  kind creative_kind not null,
  label text not null,
  status creative_status not null default 'draft',
  headline text not null default '',
  body text,
  grad_from text not null default 'violet',
  grad_to text not null default 'sky',
  compliance compliance_verdict not null default 'pass',
  compliance_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  external_ref text not null,
  agent text not null,
  agent_code text not null,
  action text not null,
  summary text not null,
  payload jsonb not null default '{}',
  checks jsonb not null default '[]',
  status approval_status not null default 'pending',
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (tenant_id, external_ref)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  user_id uuid not null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table prompt_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  external_ref text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

-- Deliberately outside tenant scope: no tenant_id, no RLS. Reachable only
-- through the audited read-only path in lib/server/platform-read.ts.
create table platform_admins (
  user_id uuid primary key references users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null default 'seed'
);

-- The integrations table from 0001 has no auth-kind column, but the UI's
-- IntegrationDetail.auth distinguishes OAuth 2.1 / API key / token.
alter table integrations add column auth_kind text not null default 'OAuth 2.1'
  check (auth_kind in ('OAuth 2.1', 'API key', 'token'));

create index campaigns_tenant_status_idx on campaigns (tenant_id, status);
create index approvals_tenant_status_idx on approvals (tenant_id, status);
create index campaign_metrics_campaign_date_idx on campaign_metrics (campaign_id, metric_date);
create index messages_conversation_created_idx on messages (conversation_id, created_at);
create index ad_groups_campaign_idx on ad_groups (campaign_id);
create index creatives_tenant_idx on creatives (tenant_id);

alter table campaigns enable row level security;
alter table ad_groups enable row level security;
alter table campaign_metrics enable row level security;
alter table creatives enable row level security;
alter table approvals enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table prompt_templates enable row level security;

alter table campaigns force row level security;
alter table ad_groups force row level security;
alter table campaign_metrics force row level security;
alter table creatives force row level security;
alter table approvals force row level security;
alter table conversations force row level security;
alter table messages force row level security;
alter table prompt_templates force row level security;

create policy campaigns_tenant_isolation on campaigns
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy ad_groups_tenant_isolation on ad_groups
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy campaign_metrics_tenant_isolation on campaign_metrics
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy creatives_tenant_isolation on creatives
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy approvals_tenant_isolation on approvals
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy conversations_tenant_isolation on conversations
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy messages_tenant_isolation on messages
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());
create policy prompt_templates_tenant_isolation on prompt_templates
  using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id());

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import nextEnv from '@next/env'
import { Pool } from '@neondatabase/serverless'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const connectionString = process.env.NEON_DATABASE_URL_UNPOOLED
if (!connectionString) throw new Error('NEON_DATABASE_URL_UNPOOLED is required in .env.local')

const adminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL
if (!adminEmail) {
  throw new Error(
    'SEED_PLATFORM_ADMIN_EMAIL is required. Set it to the email of the first platform admin so the seed never bakes an identity into source.',
  )
}

// Fixtures are TypeScript; the `tsx` loader that transpiles them on import is
// registered at process launch via `node --import tsx` (see the db:seed
// script in package.json) because Node >=20.6/18.19 rejects the older
// runtime `register('tsx/esm', ...)` hook with "must be loaded with --import".
const fx = await import(pathToFileURL(resolve(process.cwd(), 'lib/data/mock/fixtures.ts')).href)

const rupees = (n) => Math.round(n * 100)          // display rupees -> paise
const hundredths = (n) => Math.round(n * 100)      // 3.2x -> 320

const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  await client.query('begin')

  const tenant = await client.query(
    `insert into tenants (slug, name, plan, status) values ($1, $2, 'growth', 'active')
     on conflict (slug) do update set name = excluded.name returning id`,
    [fx.tenant.id, fx.tenant.name],
  )
  const tenantId = tenant.rows[0].id
  console.log(`Tenant ${fx.tenant.name} -> ${tenantId}`)

  for (const user of fx.users) {
    await client.query(
      `insert into users (tenant_id, email, display_name, role, status)
       values ($1, $2, $3, $4::helm_role, $5)
       on conflict (tenant_id, email) do update set display_name = excluded.display_name, role = excluded.role`,
      [tenantId, user.email, user.name, toDbRole(user.role), user.status],
    )
  }

  const admin = await client.query(
    `insert into users (tenant_id, email, display_name, role, status)
     values ($1, $2, 'Platform Admin', 'owner', 'active')
     on conflict (tenant_id, email) do update set role = 'owner' returning id`,
    [tenantId, adminEmail],
  )
  await client.query(
    `insert into platform_admins (user_id, granted_by) values ($1, 'seed')
     on conflict (user_id) do nothing`,
    [admin.rows[0].id],
  )
  console.log(`Platform admin -> ${adminEmail}`)

  for (const c of fx.campaignsFull) {
    const row = await client.query(
      `insert into campaigns (tenant_id, external_ref, name, channel, status, objective,
                              spend_minor, budget_minor, results, cac_minor, roas, started_at, updated_at)
       values ($1,$2,$3,$4,$5::campaign_status,$6,$7,$8,$9,$10,$11,$12, now())
       on conflict (tenant_id, external_ref) do update set
         name = excluded.name, status = excluded.status, spend_minor = excluded.spend_minor,
         budget_minor = excluded.budget_minor, results = excluded.results,
         cac_minor = excluded.cac_minor, roas = excluded.roas, updated_at = now()
       returning id`,
      [tenantId, c.id, c.name, c.channel, c.status, c.objective, rupees(c.spend), rupees(c.budget),
       c.results, c.cac === null ? null : rupees(c.cac), hundredths(c.roas), c.startedAt],
    )
    const campaignId = row.rows[0].id

    const detail = fx.campaignDetail(c.id)
    for (const g of detail.adGroups) {
      await client.query(
        `insert into ad_groups (tenant_id, campaign_id, external_ref, name, status, spend_minor, results)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (tenant_id, external_ref) do update set
           name = excluded.name, spend_minor = excluded.spend_minor, results = excluded.results`,
        [tenantId, campaignId, `${c.id}-${g.id}`, g.name, g.status, rupees(g.spend), g.results],
      )
    }

    // series is 14 points ending 2026-07-22; store one row per day.
    // Must be a for-loop with await: a forEach with un-awaited client.query
    // would race the commit below and silently lose metric rows.
    for (const [index, value] of detail.series.entries()) {
      const day = new Date(Date.UTC(2026, 6, 22) - (13 - index) * 86400000)
      await client.query(
        `insert into campaign_metrics (tenant_id, campaign_id, metric_date, spend_minor, results)
         values ($1,$2,$3,$4,$5)
         on conflict (campaign_id, metric_date) do update set
           spend_minor = excluded.spend_minor, results = excluded.results`,
        [tenantId, campaignId, day.toISOString().slice(0, 10), rupees(value * 100), value],
      )
    }

    for (const cr of detail.creatives) {
      await client.query(
        `insert into creatives (tenant_id, campaign_id, external_ref, kind, label, status, grad_from, grad_to)
         values ($1,$2,$3,$4::creative_kind,$5,$6::creative_status,$7,$8)
         on conflict (tenant_id, external_ref) do update set label = excluded.label, status = excluded.status`,
        [tenantId, campaignId, `${c.id}-${cr.id}`, cr.kind, cr.label, cr.status, cr.grad[0], cr.grad[1]],
      )
    }
  }
  console.log(`Campaigns -> ${fx.campaignsFull.length}`)

  // fixtures.approvals[].proposedAt is a bare "HH:MM" wall-clock string with
  // no date or zone attached. We anchor it to the same 2026-07-22 date used
  // by campaign_metrics and interpret the wall-clock as UTC, producing an
  // unambiguous instant for the timestamptz column. This choice is only
  // correct if lib/repositories/approvals.ts renders proposed_at back out in
  // UTC too (it does, see the comment there) -- that pairing is what makes a
  // seed -> DB -> listApprovals() round trip reproduce the exact fixture
  // string, which is the whole point of seeding FROM the fixtures.
  for (const a of fx.approvals) {
    const proposedAt = new Date(`2026-07-22T${a.proposedAt}:00Z`)
    await client.query(
      `insert into approvals (tenant_id, external_ref, agent, agent_code, action, summary, payload, checks, status, proposed_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending',$9)
       on conflict (tenant_id, external_ref) do update set
         summary = excluded.summary, payload = excluded.payload, checks = excluded.checks,
         proposed_at = excluded.proposed_at`,
      [tenantId, a.id, a.agent, a.agentCode, a.action, a.summary,
       JSON.stringify({ text: a.payload }), JSON.stringify(a.checks), proposedAt.toISOString()],
    )
  }
  console.log(`Approvals -> ${fx.approvals.length}`)

  for (const p of fx.promptTemplates) {
    await client.query(
      `insert into prompt_templates (tenant_id, external_ref, title, body)
       values ($1,$2,$3,$4)
       on conflict (tenant_id, external_ref) do update set title = excluded.title, body = excluded.body`,
      [tenantId, p.id, p.title, p.body],
    )
  }

  for (const i of fx.integrationsFull) {
    await client.query(
      `insert into integrations (tenant_id, kind, auth_kind, status, scopes, last_sync_at, updated_at)
       values ($1,$2,$3,$4::integration_status,$5, now(), now())
       on conflict (tenant_id, kind) do update set
         auth_kind = excluded.auth_kind, status = excluded.status, scopes = excluded.scopes`,
      [tenantId, i.name, i.auth, i.status, i.scopes],
    )
  }
  console.log(`Integrations -> ${fx.integrationsFull.length}`)

  await client.query('commit')
  console.log('Seed complete.')
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}

function toDbRole(uiRole) {
  return { master: 'owner', agency: 'agency_admin', strategist: 'strategist',
           creative: 'creative', analyst: 'analyst', viewer: 'client_viewer' }[uiRole]
}

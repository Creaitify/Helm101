import 'server-only'
import type { TenantQueryTransaction } from '../server/tenant-context'
import type { AdGroup, CampaignDetail, CampaignFull, CreativeAsset, SeriesColor } from '../types'

interface CampaignRowShape {
  external_ref: string
  name: string
  channel: string
  status: CampaignFull['status']
  objective: string
  spend_minor: string | number
  budget_minor: string | number
  results: number
  cac_minor: string | number | null
  roas: number
  started_at: Date | string | null
}

const CHANNEL_COLORS: Record<string, SeriesColor> = {
  Meta: 'violet', Google: 'amber', Email: 'sky', WhatsApp: 'emerald',
}

export const channelColor = (channel: string): SeriesColor => CHANNEL_COLORS[channel] ?? 'violet'

const toRupees = (minor: string | number) => Math.round(Number(minor) / 100)

const pad = (n: number) => String(n).padStart(2, '0')

// REGRESSION (Task 6, caught via live-DB check, not by unit tests): the Neon
// serverless driver returns a Postgres `date` column as a JS Date set to
// LOCAL midnight, not UTC midnight. Calling `.toISOString()` on it converts
// to UTC first, which shifts the instant backward by the local UTC offset
// for anyone east of UTC — e.g. new Date(2026, 5, 18) (2026-06-18 00:00
// local, UTC+5:30) becomes "2026-06-17T18:30:00.000Z", and slice(0, 10)
// silently returns the WRONG, PREVIOUS day. Do not "simplify" this back to
// `.toISOString().slice(0, 10)` — that reintroduces an off-by-one-day bug
// for every non-UTC user. Always read the local Y/M/D fields instead.
const toIsoDate = (value: Date | string | null): string => {
  if (value === null) return ''
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  // Driver already gave us a 'YYYY-MM-DD' string (or similar) — no timezone
  // conversion involved, so no local/UTC ambiguity to correct for.
  return String(value).slice(0, 10)
}

function toCampaignFull(row: CampaignRowShape): CampaignFull {
  const spend = toRupees(row.spend_minor)
  const budget = toRupees(row.budget_minor)
  return {
    id: row.external_ref,
    name: row.name,
    channel: row.channel,
    channelColor: channelColor(row.channel),
    status: row.status,
    spend,
    budget,
    pacingPct: budget === 0 ? 0 : Math.round((spend / budget) * 100),
    results: row.results,
    cac: row.cac_minor === null ? null : toRupees(row.cac_minor),
    roas: row.roas / 100,
    objective: row.objective,
    startedAt: toIsoDate(row.started_at),
  }
}

const SELECT_CAMPAIGN = `
  select external_ref, name, channel, status, objective, spend_minor, budget_minor,
         results, cac_minor, roas, started_at
  from campaigns`

export async function listCampaigns(tx: TenantQueryTransaction): Promise<CampaignFull[]> {
  const rows = await tx.query<CampaignRowShape>(`${SELECT_CAMPAIGN} order by started_at desc, name asc`)
  return rows.map(toCampaignFull)
}

export async function getCampaignDetailRow(
  tx: TenantQueryTransaction,
  externalRef: string,
): Promise<CampaignDetail | null> {
  const [row] = await tx.query<CampaignRowShape>(`${SELECT_CAMPAIGN} where external_ref = $1`, [externalRef])
  if (!row) return null
  const campaign = toCampaignFull(row)

  const groupRows = await tx.query<{ external_ref: string; name: string; status: AdGroup['status']; spend_minor: string; results: number }>(
    `select g.external_ref, g.name, g.status, g.spend_minor, g.results
     from ad_groups g join campaigns c on c.id = g.campaign_id
     where c.external_ref = $1 order by g.name asc`,
    [externalRef],
  )

  const creativeRows = await tx.query<{ external_ref: string; kind: CreativeAsset['kind']; label: string; status: CreativeAsset['status']; grad_from: SeriesColor; grad_to: SeriesColor }>(
    `select cr.external_ref, cr.kind, cr.label, cr.status, cr.grad_from, cr.grad_to
     from creatives cr join campaigns c on c.id = cr.campaign_id
     where c.external_ref = $1 order by cr.created_at asc`,
    [externalRef],
  )

  const metricRows = await tx.query<{ results: number }>(
    `select m.results from campaign_metrics m join campaigns c on c.id = m.campaign_id
     where c.external_ref = $1 order by m.metric_date asc limit 14`,
    [externalRef],
  )

  return {
    campaign,
    adGroups: groupRows.map((g) => ({
      id: g.external_ref.replace(`${externalRef}-`, ''),
      name: g.name,
      status: g.status,
      spend: toRupees(g.spend_minor),
      results: g.results,
    })),
    creatives: creativeRows.map((cr) => ({
      id: cr.external_ref.replace(`${externalRef}-`, ''),
      kind: cr.kind,
      label: cr.label,
      status: cr.status,
      grad: [cr.grad_from, cr.grad_to],
    })),
    series: metricRows.map((m) => m.results),
  }
}

import { describe, it, expect } from 'vitest'
import { listCampaigns, channelColor } from '@/lib/repositories/campaigns'
import type { TenantQueryTransaction } from '@/lib/server/tenant-context'

function stubTx(rows: unknown[]): { tx: TenantQueryTransaction; seen: string[] } {
  const seen: string[] = []
  const tx: TenantQueryTransaction = {
    execute: async () => {},
    query: async <T>(statement: string) => { seen.push(statement); return rows as T[] },
  }
  return { tx, seen }
}

describe('campaigns repository', () => {
  it('maps minor units back to display rupees and hundredths back to roas', async () => {
    // The Neon driver returns Postgres `date` columns as a JS Date at LOCAL
    // midnight (not UTC midnight) — new Date(2026, 5, 18) reproduces that,
    // unlike new Date('2026-06-18T00:00:00Z') which masks a UTC-conversion bug.
    const { tx } = stubTx([{
      external_ref: 'c1', name: 'FHC · Retargeting', channel: 'Meta', status: 'active',
      objective: 'Lowest CAC / checkup', spend_minor: '15600000', budget_minor: '23000000',
      results: 458, cac_minor: '34100', roas: 320, started_at: new Date(2026, 5, 18),
    }])
    const [campaign] = await listCampaigns(tx)
    expect(campaign.id).toBe('c1')
    expect(campaign.spend).toBe(156000)
    expect(campaign.budget).toBe(230000)
    expect(campaign.cac).toBe(341)
    expect(campaign.roas).toBe(3.2)
    expect(campaign.pacingPct).toBe(68)
    expect(campaign.startedAt).toBe('2026-06-18')
  })

  it('formats a local-midnight Date in a different month without losing zero-padding', async () => {
    const { tx } = stubTx([{
      external_ref: 'c5', name: 'Spring Launch', channel: 'Google', status: 'active',
      objective: 'Awareness', spend_minor: '0', budget_minor: '100000',
      results: 0, cac_minor: null, roas: 0, started_at: new Date(2026, 0, 5),
    }])
    const [campaign] = await listCampaigns(tx)
    expect(campaign.startedAt).toBe('2026-01-05')
  })

  it('passes through a plain YYYY-MM-DD string from the driver unchanged', async () => {
    const { tx } = stubTx([{
      external_ref: 'c6', name: 'String Date', channel: 'Email', status: 'active',
      objective: 'Retention', spend_minor: '0', budget_minor: '100000',
      results: 0, cac_minor: null, roas: 0, started_at: '2026-06-18',
    }])
    const [campaign] = await listCampaigns(tx)
    expect(campaign.startedAt).toBe('2026-06-18')
  })

  it('preserves a null cac rather than coercing it to zero', async () => {
    const { tx } = stubTx([{
      external_ref: 'c4', name: 'Reels · Awareness', channel: 'Meta', status: 'review',
      objective: 'Top-of-funnel reach', spend_minor: '0', budget_minor: '8000000',
      results: 0, cac_minor: null, roas: 0, started_at: new Date('2026-07-15T00:00:00Z'),
    }])
    const [campaign] = await listCampaigns(tx)
    expect(campaign.cac).toBeNull()
    expect(campaign.pacingPct).toBe(0)
  })

  it('never interpolates a tenant id into SQL', async () => {
    const { tx, seen } = stubTx([])
    await listCampaigns(tx)
    expect(seen[0]).not.toMatch(/tenant_id\s*=\s*'/)
  })

  it('assigns the channel colours the UI expects', () => {
    expect(channelColor('Meta')).toBe('violet')
    expect(channelColor('Google')).toBe('amber')
    expect(channelColor('Email')).toBe('sky')
    expect(channelColor('WhatsApp')).toBe('emerald')
    expect(channelColor('Unknown')).toBe('violet')
  })
})

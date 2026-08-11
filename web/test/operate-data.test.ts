import { describe, it, expect } from 'vitest'
import * as data from '@/lib/data'

describe('operate data', () => {
  it('campaign detail resolves for a known id', async () => {
    const list = await data.getCampaignsFull()
    expect(list.length).toBeGreaterThanOrEqual(6)
    // getCampaignDetail returns null for an id the tenant cannot see, so the
    // type is CampaignDetail | null. This id came from getCampaignsFull, so a
    // null here is itself a failure — assert it, then keep the same checks.
    const detail = await data.getCampaignDetail(list[0].id)
    expect(detail).not.toBeNull()
    expect(detail!.campaign.id).toBe(list[0].id)
    expect(detail!.adGroups.length).toBeGreaterThan(0)
    expect(detail!.series.length).toBe(14)
  })
  it('exposes approvals, prompts, integrations', async () => {
    expect((await data.getApprovals()).length).toBe(3)
    expect((await data.getPromptTemplates()).length).toBeGreaterThanOrEqual(4)
    const ints = await data.getIntegrationsFull()
    expect(ints.some((i) => i.status === 'disconnected')).toBe(true)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as data from '@/lib/data'
import * as fx from '@/lib/data/mock/fixtures'

/**
 * The demo seam: every getter serves fixtures unconditionally, with zero
 * database-environment sensitivity left. The Phase A fallback ladder
 * (Neon reads classified into fixture/empty/throw) is gone; these getters
 * swap to helm-api calls one endpoint at a time in phase 2.
 */
describe('lib/data demo seam', () => {
  const originalNeonUrl = process.env.NEON_DATABASE_URL

  beforeEach(() => {
    // A leftover Phase A variable must change nothing.
    process.env.NEON_DATABASE_URL = 'postgres://garbage:5432/nowhere'
  })

  afterEach(() => {
    if (originalNeonUrl === undefined) delete process.env.NEON_DATABASE_URL
    else process.env.NEON_DATABASE_URL = originalNeonUrl
  })

  it('serves the formerly DB-backed aggregates from fixtures', async () => {
    await expect(data.getUsers()).resolves.toEqual(fx.users)
    await expect(data.getCampaignsFull()).resolves.toEqual(fx.campaignsFull)
    await expect(data.getApprovals()).resolves.toEqual(fx.approvals)
    await expect(data.getPromptTemplates()).resolves.toEqual(fx.promptTemplates)
    await expect(data.getIntegrationsFull()).resolves.toEqual(fx.integrationsFull)
  })

  it('returns a detail only for a known campaign id', async () => {
    const known = fx.campaignsFull[0].id
    const detail = await data.getCampaignDetail(known)
    expect(detail?.campaign.id).toBe(known)
  })

  // fx.campaignDetail(id) fabricates a populated detail for ANY id; the
  // existence guard in lib/data must keep a probing client at null.
  it('returns null, never fabricated data, for an unknown campaign id', async () => {
    await expect(data.getCampaignDetail('nonexistent')).resolves.toBeNull()
  })
})

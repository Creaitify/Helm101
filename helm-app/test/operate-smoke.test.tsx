import { describe, it, expect } from 'vitest'
import { campaignsFull, approvals, integrationsFull, promptTemplates } from '@/lib/data/mock/fixtures'

describe('operate surfaces data present', () => {
  it('has data behind every surface', () => {
    expect(campaignsFull.length).toBeGreaterThanOrEqual(6)
    expect(approvals.length).toBe(3)
    expect(integrationsFull.length).toBeGreaterThanOrEqual(7)
    expect(promptTemplates.length).toBeGreaterThanOrEqual(4)
  })
})

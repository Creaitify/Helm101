import { describe, it, expect } from 'vitest'
import * as data from '@/lib/data'

describe('data layer cutover', () => {
  it('falls back to fixtures when no database is configured', async () => {
    delete process.env.NEON_DATABASE_URL
    const campaigns = await data.getCampaignsFull()
    expect(campaigns.length).toBe(8)
    expect(campaigns[0]).toHaveProperty('channelColor')
  })

  it('keeps every campaign shape the UI relies on', async () => {
    const [campaign] = await data.getCampaignsFull()
    for (const key of ['id', 'name', 'channel', 'channelColor', 'status', 'spend', 'budget', 'pacingPct', 'results', 'cac', 'roas', 'objective', 'startedAt']) {
      expect(campaign).toHaveProperty(key)
    }
  })

  it('exposes a tenant value resolver for the shell', async () => {
    expect(typeof data.getCurrentTenantValue).toBe('function')
  })
})

describe('fallback classification', () => {
  it('treats missing config and unauthenticated callers as expected', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('Missing required server environment variable: databaseUrl'))).toBe(true)
    expect(isExpectedFallback(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true)
    class UnauthenticatedError extends Error {}
    expect(isExpectedFallback(new UnauthenticatedError('nope'))).toBe(true)
  })

  it('does NOT swallow a genuine query bug', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('column "spend_minor" does not exist'))).toBe(false)
    expect(isExpectedFallback(new Error('syntax error at or near "slect"'))).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as data from '@/lib/data'
import { UnauthenticatedError, NoMembershipError } from '@/lib/server/tenant-session'

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
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.HELM_ENV
  })

  it('treats missing config and unauthenticated callers as expected', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('Missing required server environment variable: databaseUrl'))).toBe(true)
    const econnrefused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })
    expect(isExpectedFallback(econnrefused)).toBe(true)
    const enotfound = Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' })
    expect(isExpectedFallback(enotfound)).toBe(true)
    expect(isExpectedFallback(new UnauthenticatedError())).toBe(true)
    expect(isExpectedFallback(new NoMembershipError('a@b.com'))).toBe(true)
  })

  it('does NOT swallow a genuine query bug', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('column "spend_minor" does not exist'))).toBe(false)
    expect(isExpectedFallback(new Error('syntax error at or near "slect"'))).toBe(false)
  })

  // IMPORTANT 5: constructor.name matching means any unrelated class sharing
  // the name "UnauthenticatedError" would previously be misclassified as
  // expected. isExpectedFallback must use instanceof against the real
  // exported classes instead.
  it('does NOT recognize an unrelated class merely sharing the name UnauthenticatedError', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    class UnauthenticatedError extends Error {}
    expect(isExpectedFallback(new UnauthenticatedError('nope'))).toBe(false)
  })

  it('does NOT recognize an unrelated class merely sharing the name NoMembershipError', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    class NoMembershipError extends Error {}
    expect(isExpectedFallback(new NoMembershipError('nope'))).toBe(false)
  })

  // IMPORTANT 4: message-substring matching would misclassify a genuine SQL
  // error whose message happens to embed a matched token (e.g. a stored sync
  // error value). Only real Node socket error codes should count.
  it('does not misclassify a genuine SQL error whose message happens to contain a matched token', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    const genuineError = new Error(
      'invalid input syntax for type json: "last sync failed: ECONNREFUSED at upstream"',
    )
    expect(isExpectedFallback(genuineError)).toBe(false)
    const genuineError2 = new Error('duplicate key value violates unique constraint "password authentication failed_key"')
    expect(isExpectedFallback(genuineError2)).toBe(false)
  })

  // IMPORTANT 6: Next.js control-flow signals (thrown during static
  // prerendering / redirects) must never be classified as "expected
  // fallback" fixture-worthy errors OR as ordinary unexpected errors to log
  // -- they must be re-thrown untouched, before any other classification.
  it('treats DYNAMIC_SERVER_USAGE and NEXT_REDIRECT digests as neither expected-fallback nor loggable-unexpected', async () => {
    const { isExpectedFallback, isNextControlFlowSignal } = (await import('@/lib/data')) as unknown as {
      isExpectedFallback: (e: unknown) => boolean
      isNextControlFlowSignal: (e: unknown) => boolean
    }
    const dynamicUsage = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' })
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
    expect(isExpectedFallback(dynamicUsage)).toBe(false)
    expect(isExpectedFallback(redirect)).toBe(false)
    expect(isNextControlFlowSignal(dynamicUsage)).toBe(true)
    expect(isNextControlFlowSignal(redirect)).toBe(true)
    expect(isNextControlFlowSignal(new Error('column does not exist'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CRITICAL 1: the production re-throw must actually fire in production.
// ---------------------------------------------------------------------------
describe('production re-throw for unexpected errors', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEON_DATABASE_URL = 'postgres://fake'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.HELM_ENV
    delete process.env.NEON_DATABASE_URL
    vi.doUnmock('../lib/server/tenant-session')
    vi.doUnmock('../lib/server/db')
    vi.doUnmock('../lib/repositories/campaigns')
    vi.resetModules()
  })

  it('re-throws an unexpected error when NODE_ENV=production, even though HELM_ENV is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', () => ({
      RlsBypassError: class extends Error {},
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    }))
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('column "spend_minor" does not exist')
  })

  it('re-throws an unexpected error when HELM_ENV=production', async () => {
    process.env.HELM_ENV = 'production'
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', () => ({
      RlsBypassError: class extends Error {},
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    }))
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('column "spend_minor" does not exist')
  })

  it('falls back to fixtures for an unexpected error outside production', async () => {
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', () => ({
      RlsBypassError: class extends Error {},
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    }))
    const freshData = await import('@/lib/data')
    const campaigns = await freshData.getCampaignsFull()
    expect(campaigns.length).toBe(8)
  })

  it('trims whitespace in HELM_ENV via env.appEnv (not a raw process.env read)', async () => {
    process.env.HELM_ENV = '  production  '
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', () => ({
      RlsBypassError: class extends Error {},
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    }))
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('column "spend_minor" does not exist')
  })
})

// ---------------------------------------------------------------------------
// CRITICAL 2: an unknown/foreign campaign id must not return fabricated
// fixture data. Repository null must propagate as null.
// ---------------------------------------------------------------------------
describe('getCampaignDetail: unknown id on the DB path', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEON_DATABASE_URL = 'postgres://fake'
  })

  afterEach(() => {
    delete process.env.NEON_DATABASE_URL
    vi.doUnmock('@/lib/server/tenant-session')
    vi.doUnmock('@/lib/server/db')
    vi.doUnmock('@/lib/repositories/campaigns')
    vi.resetModules()
  })

  it('returns null (not a fabricated fixture) when the repository finds no row for the id', async () => {
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', () => ({
      RlsBypassError: class extends Error {},
      withTenantContext: async (_ctx: unknown, work: (tx: unknown) => unknown) => work({}),
    }))
    vi.doMock('@/lib/repositories/campaigns', () => ({
      getCampaignDetailRow: async () => null,
    }))
    const freshData = await import('@/lib/data')
    const result = await freshData.getCampaignDetail('c-belongs-to-another-tenant')
    expect(result).toBeNull()
  })

  it('returns the real row when the repository finds one', async () => {
    const fakeDetail = { campaign: { id: 'real-id' }, adGroups: [], creatives: [], series: [] }
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', () => ({
      RlsBypassError: class extends Error {},
      withTenantContext: async (_ctx: unknown, work: (tx: unknown) => unknown) => work({}),
    }))
    vi.doMock('@/lib/repositories/campaigns', () => ({
      getCampaignDetailRow: async () => fakeDetail,
    }))
    const freshData = await import('@/lib/data')
    const result = await freshData.getCampaignDetail('real-id')
    expect(result).toEqual(fakeDetail)
  })

  it('still falls back to the fixture (the legitimate no-database path) when no database is configured', async () => {
    delete process.env.NEON_DATABASE_URL
    const result = await data.getCampaignDetail('any-id')
    expect(result).not.toBeNull()
    expect(result?.campaign).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// IMPORTANT 7: the RLS-bypass guard must fail closed in every environment,
// never fall back to fixtures.
// ---------------------------------------------------------------------------
describe('RLS-bypass guard fails closed', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEON_DATABASE_URL = 'postgres://fake'
  })

  afterEach(() => {
    delete process.env.NEON_DATABASE_URL
    vi.unstubAllEnvs()
    vi.doUnmock('@/lib/server/tenant-session')
    vi.doUnmock('@/lib/server/db')
    vi.resetModules()
  })

  it('re-throws RlsBypassError unconditionally, even outside production', async () => {
    const { RlsBypassError } = await import('@/lib/server/db')
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    vi.doMock('@/lib/server/db', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/db')>('@/lib/server/db')
      return {
        ...actual,
        withTenantContext: async () => {
          throw new actual.RlsBypassError('neondb_owner')
        },
      }
    })
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toBeInstanceOf(RlsBypassError)
  })
})

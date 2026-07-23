import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as data from '@/lib/data'
import { UnauthenticatedError, NoMembershipError } from '@/lib/server/tenant-session'

// MINOR G: a shared mock factory that re-exports the REAL RlsBypassError (via
// importActual) instead of each call site redeclaring `class extends Error
// {}`, which is a different class object than the one lib/data/index.ts
// imports -- `instanceof` against it would silently be false, letting a test
// take the wrong branch without failing.
async function mockDb(overrides: Record<string, unknown>) {
  const actual = await vi.importActual<typeof import('@/lib/server/db')>('@/lib/server/db')
  vi.doMock('@/lib/server/db', () => ({
    ...actual,
    ...overrides,
  }))
}

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
    expect(isExpectedFallback(new UnauthenticatedError())).toBe(true)
    expect(isExpectedFallback(new NoMembershipError('a@b.com'))).toBe(true)
  })

  // CRITICAL A: the driver never sets a Node errno on a top-level `.code` --
  // that field is reused by NeonDbError to carry the Postgres SQLSTATE. The
  // real connect-failure shape (verified against
  // node_modules/@neondatabase/serverless/index.js) is:
  //   new Error('Error connecting to database: ' + e); err.sourceError = e
  // with the Node errno on the INNER sourceError.code.
  it('treats a real Neon connect-failure wrapper (sourceError.code) as expected', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    const econnrefused = Object.assign(
      new Error('Error connecting to database: connect ECONNREFUSED 127.0.0.1:5432'),
      { sourceError: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }) },
    )
    expect(isExpectedFallback(econnrefused)).toBe(true)
    const enotfound = Object.assign(
      new Error('Error connecting to database: getaddrinfo ENOTFOUND example.invalid'),
      { sourceError: Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' }) },
    )
    expect(isExpectedFallback(enotfound)).toBe(true)
  })

  it('does NOT swallow a genuine query bug', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('column "spend_minor" does not exist'))).toBe(false)
    expect(isExpectedFallback(new Error('syntax error at or near "slect"'))).toBe(false)
  })

  // CRITICAL A (part 2): a NeonDbError-shaped error carrying a top-level
  // SQLSTATE on `.code` (e.g. '42703' undefined column) must NOT be
  // classified as expected merely because it happens to have a `.code`
  // property -- that would be the same class of bug as message-substring
  // matching, displaced onto the wrong field.
  it('does NOT classify a NeonDbError-shaped SQLSTATE error as expected', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    class NeonDbError extends Error {
      code: string | undefined
      constructor(message: string, code: string) {
        super(message)
        this.name = 'NeonDbError'
        this.code = code
      }
    }
    const undefinedColumn = new NeonDbError('column "spend_minor" does not exist', '42703')
    expect(isExpectedFallback(undefinedColumn)).toBe(false)
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

  // IMPORTANT B: a bad DB password must fail loud, not be silently answered
  // with a fully-populated fixture UI. Postgres SQLSTATE 28P01
  // (invalid_password) / 28000 (invalid_authorization_specification) is
  // read off NeonDbError's top-level `.code` -- a structural check, not
  // message-substring matching.
  it('classifies a SQLSTATE 28P01/28000 auth failure as NOT expected-fallback (must fail loud)', async () => {
    const { isExpectedFallback, isAuthFailure } = (await import('@/lib/data')) as unknown as {
      isExpectedFallback: (e: unknown) => boolean
      isAuthFailure: (e: unknown) => boolean
    }
    const badPassword = Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' })
    const badAuthSpec = Object.assign(new Error('no pg_hba.conf entry for host'), { code: '28000' })
    expect(isAuthFailure(badPassword)).toBe(true)
    expect(isAuthFailure(badAuthSpec)).toBe(true)
    expect(isExpectedFallback(badPassword)).toBe(false)
    expect(isExpectedFallback(badAuthSpec)).toBe(false)
    expect(isAuthFailure(new Error('column "spend_minor" does not exist'))).toBe(false)
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
    await mockDb({
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    })
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
    await mockDb({
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    })
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('column "spend_minor" does not exist')
  })

  it('falls back to fixtures for an unexpected error outside production', async () => {
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    await mockDb({
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    })
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
    await mockDb({
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    })
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
    await mockDb({
      withTenantContext: async (_ctx: unknown, work: (tx: unknown) => unknown) => work({}),
    })
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
    await mockDb({
      withTenantContext: async (_ctx: unknown, work: (tx: unknown) => unknown) => work({}),
    })
    vi.doMock('@/lib/repositories/campaigns', () => ({
      getCampaignDetailRow: async () => fakeDetail,
    }))
    const freshData = await import('@/lib/data')
    const result = await freshData.getCampaignDetail('real-id')
    expect(result).toEqual(fakeDetail)
  })

  it('still falls back to the fixture (the legitimate no-database path) when no database is configured', async () => {
    delete process.env.NEON_DATABASE_URL
    const result = await data.getCampaignDetail('c1')
    expect(result).not.toBeNull()
    expect(result?.campaign).toBeDefined()
  })

  // IMPORTANT C: fixtures.campaignDetail(id) itself falls back to
  // campaignsFull[0] for ANY unknown id. On the legitimate no-database path
  // (e.g. an unauthenticated caller) an attacker-controlled id must still
  // yield null, not a fabricated populated campaign pane.
  it('returns null (not a fabricated fixture) for an unknown id on the no-database path', async () => {
    delete process.env.NEON_DATABASE_URL
    const result = await data.getCampaignDetail('definitely-not-a-real-campaign-id')
    expect(result).toBeNull()
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
    await mockDb({
      withTenantContext: async () => {
        throw new RlsBypassError('neondb_owner')
      },
    })
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toBeInstanceOf(RlsBypassError)
  })
})

// ---------------------------------------------------------------------------
// IMPORTANT B: an authentication failure (bad DB password) must fail closed
// in every environment, never fall back to fixtures -- same fail-loud class
// as RlsBypassError.
// ---------------------------------------------------------------------------
describe('auth failure fails closed', () => {
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

  it('re-throws a SQLSTATE 28P01 auth failure unconditionally, even outside production', async () => {
    vi.doMock('@/lib/server/tenant-session', () => ({
      UnauthenticatedError: class extends Error {},
      NoMembershipError: class extends Error {},
      requireTenantContext: async () => ({ tenantId: 't1' }),
    }))
    await mockDb({
      withTenantContext: async () => {
        throw Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' })
      },
    })
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('password authentication failed')
  })
})

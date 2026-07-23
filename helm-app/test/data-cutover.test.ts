import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as data from '@/lib/data'
import { UnauthenticatedError, NoMembershipError } from '@/lib/server/tenant-session'
import { DatabaseUnreachableError } from '@/lib/server/db'

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

// MINOR M3: same shared-mock-factory issue as mockDb above, but for
// @/lib/server/tenant-session -- most call sites redeclare
// UnauthenticatedError/NoMembershipError as fresh `class extends Error {}`,
// which is a DIFFERENT class object than the one lib/data/index.ts imports,
// so `instanceof` against the real classes would silently be false there.
// Re-exports the REAL classes via importActual, only overriding
// requireTenantContext (and anything else the test needs to stub).
async function mockTenantSession(overrides: Record<string, unknown>) {
  const actual = await vi.importActual<typeof import('@/lib/server/tenant-session')>('@/lib/server/tenant-session')
  vi.doMock('@/lib/server/tenant-session', () => ({
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

  // CRITICAL (round 3): this app uses the Pool (WebSocket) driver, not
  // neon(). A real unreachable-database failure never arrives with a
  // sourceError/errno shape at all -- verified directly against the
  // installed driver (see task-11-fix3-report): it surfaces as a raw
  // ErrorEvent with no message and no code. There is nothing to structurally
  // sniff downstream, so classification happens at the lib/server/db.ts
  // pool.connect() boundary instead, which re-throws a typed
  // DatabaseUnreachableError. isExpectedFallback need only check instanceof.
  it('treats DatabaseUnreachableError as expected (falls back to fixtures)', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new DatabaseUnreachableError(new Error('connect failed')))).toBe(true)
  })

  it('does NOT swallow a genuine query bug', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    expect(isExpectedFallback(new Error('column "spend_minor" does not exist'))).toBe(false)
    expect(isExpectedFallback(new Error('syntax error at or near "slect"'))).toBe(false)
  })

  // A plain-Error SQL error (SQLSTATE 42703, undefined column) carried on a
  // top-level `.code`, exactly like NeonDbError documents, must NOT be
  // classified as expected merely because it has a `.code` property -- only
  // a real DatabaseUnreachableError (thrown at the connection boundary)
  // counts.
  it('does NOT classify a plain SQLSTATE 42703 SQL error as expected', async () => {
    const { isExpectedFallback } = await import('@/lib/data')
    const undefinedColumn = Object.assign(new Error('column "spend_minor" does not exist'), { code: '42703' })
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
  // read off the error's top-level `.code` -- a structural check, not
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

  // Finding I1: isAuthFailure must be gated on `error instanceof Error`
  // before reading `.code` -- otherwise an arbitrary non-Error object (e.g.
  // a plain object accidentally carrying a `.code` field from unrelated
  // code, or a malformed mock) with `.code === '28P01'` would trigger the
  // unconditional fail-loud throw even though it is not a real Postgres
  // auth rejection.
  it('does NOT treat a non-Error object carrying .code === "28P01" as an auth failure', async () => {
    const { isAuthFailure } = (await import('@/lib/data')) as unknown as {
      isAuthFailure: (e: unknown) => boolean
    }
    const notAnError = { code: '28P01', message: 'looks like an auth failure but is not an Error' }
    expect(isAuthFailure(notAnError)).toBe(false)
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
    await mockDb({
      withTenantContext: async () => {
        throw new Error('column "spend_minor" does not exist')
      },
    })
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('column "spend_minor" does not exist')
  })

  it('falls back to fixtures for an unexpected error outside production', async () => {
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
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
// Finding I4: a real DatabaseUnreachableError raised through withTenantContext
// must NOT throw (no 500), but it must also NOT serve fixtures -- Finnovate's
// fixture campaign detail (ids c1-c8) leaking to an authenticated user of any
// other tenant during a genuine outage would misrepresent someone else's
// data with plausible-looking numbers (spec S8). Fixtures are reserved for
// the genuine no-NEON_DATABASE_URL case, asserted separately below. An
// outage with a database CONFIGURED must surface an empty result so the UI
// renders its empty state instead.
// ---------------------------------------------------------------------------
describe('DatabaseUnreachableError with a configured database returns empty, not fixtures', () => {
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

  it('does not throw (even in production) but returns an EMPTY list, not Finnovate fixture campaigns', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { DatabaseUnreachableError: RealDatabaseUnreachableError } = await import('@/lib/server/db')
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
    await mockDb({
      withTenantContext: async () => {
        throw new RealDatabaseUnreachableError(new Error('connect ECONNREFUSED'))
      },
    })
    const freshData = await import('@/lib/data')
    const campaigns = await freshData.getCampaignsFull()
    expect(campaigns).toEqual([])
  })

  it('getCampaignDetail returns null (not Finnovate\'s fixture detail) during an outage, for any id including c1-c8', async () => {
    const { DatabaseUnreachableError: RealDatabaseUnreachableError } = await import('@/lib/server/db')
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
    await mockDb({
      withTenantContext: async () => {
        throw new RealDatabaseUnreachableError(new Error('connect ECONNREFUSED'))
      },
    })
    const freshData = await import('@/lib/data')
    // 'c1' is a real fixture id -- proves the outage path is reserved
    // regardless of whether the id would otherwise resolve to a fixture.
    const result = await freshData.getCampaignDetail('c1')
    expect(result).toBeNull()
  })

  it('every array-shaped read() caller returns empty during an outage, not its fixture', async () => {
    const { DatabaseUnreachableError: RealDatabaseUnreachableError } = await import('@/lib/server/db')
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
    await mockDb({
      withTenantContext: async () => {
        throw new RealDatabaseUnreachableError(new Error('connect ECONNREFUSED'))
      },
    })
    const freshData = await import('@/lib/data')
    expect(await freshData.getUsers()).toEqual([])
    expect(await freshData.getApprovals()).toEqual([])
    expect(await freshData.getPromptTemplates()).toEqual([])
    expect(await freshData.getIntegrationsFull()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Companion to the outage tests above: the genuine no-database dev/test path
// (NEON_DATABASE_URL unset entirely) must still serve fixtures -- this is
// what keeps local dev and every other test in this file working without a
// live Neon connection. Only the "configured but unreachable" case changed.
// ---------------------------------------------------------------------------
describe('no NEON_DATABASE_URL still serves fixtures', () => {
  it('getCampaignsFull serves the Finnovate fixture when no database is configured at all', async () => {
    delete process.env.NEON_DATABASE_URL
    const campaigns = await data.getCampaignsFull()
    expect(campaigns.length).toBe(8)
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
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1' }),
    })
    await mockDb({
      withTenantContext: async () => {
        throw Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' })
      },
    })
    const freshData = await import('@/lib/data')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('password authentication failed')
  })

  // REGRESSION (round 4 CRITICAL): the previous test above mocks
  // @/lib/server/db's `withTenantContext` entirely, so it never exercises the
  // probe-query catch block inside the REAL withTenantContext -- the exact
  // site that used to blanket-wrap every probe-query failure (including a
  // reached-database SQLSTATE 28P01) into DatabaseUnreachableError, which
  // isExpectedFallback then silently swallowed into a fixture response. This
  // test mocks only the driver's `Pool` class (one level lower than @/lib/data
  // vs @/lib/server/db) so the real withTenantContext -- including its
  // assertRuntimeRoleCannotBypassRls probe-query catch -- actually runs.
  it('does NOT reclassify a reached-database 28P01 from the RLS probe query as DatabaseUnreachableError (must fail loud, not fall back to fixtures)', async () => {
    vi.doMock('@neondatabase/serverless', () => ({
      Pool: class {
        async query() {
          throw Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' })
        }
        async connect(): Promise<never> {
          throw new Error('connect() should not be reached: the probe query must fail first')
        }
        async end() {}
      },
    }))
    await mockTenantSession({
      requireTenantContext: async () => ({ tenantId: 't1', userId: 'u1', role: 'owner', scopes: [] }),
    })
    const freshDb = await import('@/lib/server/db')
    const freshData = await import('@/lib/data')

    const caught: unknown = await freshDb
      .withTenantContext({ tenantId: 't1', userId: 'u1', role: 'owner', scopes: [] }, async () => 'unreachable')
      .catch((e: unknown) => e)

    expect(caught).not.toBeInstanceOf(freshDb.DatabaseUnreachableError)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('password authentication failed')
    expect((caught as { code?: unknown }).code).toBe('28P01')
    expect(freshData.isExpectedFallback(caught)).toBe(false)

    vi.doUnmock('@neondatabase/serverless')
    await expect(freshData.getCampaignsFull()).rejects.toThrow('password authentication failed')
  })
})

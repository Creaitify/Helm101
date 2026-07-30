import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mirrors the shared-mock-factory lesson from test/data-cutover.test.ts:
// modules that export error classes used with `instanceof` (or, more
// generally, any surface the code under test relies on beyond the one
// function being stubbed) are re-exported via vi.importActual and spread,
// not redeclared -- so the mock stays a faithful stand-in for the real
// module instead of silently diverging from it.

const REAL_CONTEXT = Object.freeze({
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'strategist' as const,
  scopes: Object.freeze(['analytics.read', 'campaigns.write', 'approvals.decide', 'workspace.write']),
})

function makeContext(scopes: readonly string[]) {
  return Object.freeze({ ...REAL_CONTEXT, scopes: Object.freeze([...scopes]) })
}

async function mockCollaborators(opts: {
  scopes: readonly string[]
  decideApprovalImpl?: (...args: unknown[]) => unknown
}) {
  const context = makeContext(opts.scopes)

  const requireTenantContext = vi.fn().mockResolvedValue(context)
  vi.doMock('@/lib/server/tenant-session', async () => {
    const actual = await vi.importActual<typeof import('@/lib/server/tenant-session')>('@/lib/server/tenant-session')
    return { ...actual, requireTenantContext }
  })

  // withTenantContext just needs to invoke the work function with some tx
  // stand-in and return its result -- exactly enough behavior for the code
  // under test to reach decideApproval, without spinning up a real pool.
  const withTenantContext = vi.fn(async (ctx: unknown, work: (tx: unknown) => unknown) => work({}))
  vi.doMock('@/lib/server/db', async () => {
    const actual = await vi.importActual<typeof import('@/lib/server/db')>('@/lib/server/db')
    return { ...actual, withTenantContext }
  })

  const decideApproval = vi.fn(opts.decideApprovalImpl ?? (async () => undefined))
  vi.doMock('@/lib/repositories/approvals', async () => {
    const actual = await vi.importActual<typeof import('@/lib/repositories/approvals')>('@/lib/repositories/approvals')
    return { ...actual, decideApproval }
  })

  const revalidatePath = vi.fn()
  vi.doMock('next/cache', () => ({ revalidatePath }))

  return { context, requireTenantContext, withTenantContext, decideApproval, revalidatePath }
}

describe('submitApprovalDecision', () => {
  const originalDbUrl = process.env.NEON_DATABASE_URL

  beforeEach(() => {
    vi.resetModules()
    // The function short-circuits to a no-op when NEON_DATABASE_URL is
    // unset (documented behavior for tests/offline dev) -- these tests are
    // exercising the enforcement path, so a database must appear configured.
    process.env.NEON_DATABASE_URL = 'postgres://test-placeholder/db'
  })

  afterEach(() => {
    vi.doUnmock('@/lib/server/tenant-session')
    vi.doUnmock('@/lib/server/db')
    vi.doUnmock('@/lib/repositories/approvals')
    vi.doUnmock('next/cache')
    if (originalDbUrl === undefined) delete process.env.NEON_DATABASE_URL
    else process.env.NEON_DATABASE_URL = originalDbUrl
  })

  it('rejects a caller without approvals.decide and never reaches decideApproval', async () => {
    const { decideApproval, withTenantContext } = await mockCollaborators({ scopes: ['analytics.read'] })
    const { submitApprovalDecision } = await import('@/app/(app)/approvals/actions')

    await expect(submitApprovalDecision('a1', 'approved')).rejects.toThrow(/approvals\.decide/)
    expect(decideApproval).not.toHaveBeenCalled()
    expect(withTenantContext).not.toHaveBeenCalled()
  })

  it('allows a caller with approvals.decide and calls decideApproval exactly once with the right args', async () => {
    const { decideApproval, requireTenantContext } = await mockCollaborators({
      scopes: ['analytics.read', 'approvals.decide'],
    })
    const { submitApprovalDecision } = await import('@/app/(app)/approvals/actions')

    const result = await submitApprovalDecision('a1', 'rejected')

    expect(result).toEqual({ ok: true })
    expect(decideApproval).toHaveBeenCalledTimes(1)
    const [, contextArg, inputArg] = decideApproval.mock.calls[0]
    expect(inputArg).toEqual({ externalRef: 'a1', decision: 'rejected' })
    // Tenant identity must be exactly what requireTenantContext produced --
    // never anything derived from the (attacker-controlled) arguments.
    expect(contextArg).toBe(await requireTenantContext.mock.results[0].value)
  })

  it('rejects an invalid decision before requireTenantContext is ever called', async () => {
    const { requireTenantContext, decideApproval } = await mockCollaborators({
      scopes: ['analytics.read', 'approvals.decide'],
    })
    const { submitApprovalDecision } = await import('@/app/(app)/approvals/actions')

    await expect(submitApprovalDecision('a1', 'maybe' as unknown as 'approved')).rejects.toThrow('Invalid decision')
    expect(requireTenantContext).not.toHaveBeenCalled()
    expect(decideApproval).not.toHaveBeenCalled()
  })

  it('rejects a path-traversal-shaped externalRef before requireTenantContext is ever called', async () => {
    const { requireTenantContext, decideApproval } = await mockCollaborators({
      scopes: ['analytics.read', 'approvals.decide'],
    })
    const { submitApprovalDecision } = await import('@/app/(app)/approvals/actions')

    await expect(submitApprovalDecision('../../etc/passwd', 'approved')).rejects.toThrow('Invalid externalRef')
    expect(requireTenantContext).not.toHaveBeenCalled()
    expect(decideApproval).not.toHaveBeenCalled()
  })

  it('rejects an absurdly long externalRef before requireTenantContext is ever called', async () => {
    const { requireTenantContext, decideApproval } = await mockCollaborators({
      scopes: ['analytics.read', 'approvals.decide'],
    })
    const { submitApprovalDecision } = await import('@/app/(app)/approvals/actions')

    const longRef = 'a'.repeat(200)
    await expect(submitApprovalDecision(longRef, 'approved')).rejects.toThrow('Invalid externalRef')
    expect(requireTenantContext).not.toHaveBeenCalled()
    expect(decideApproval).not.toHaveBeenCalled()
  })

  it('is a server action', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'app/(app)/approvals/actions.ts'), 'utf8')
    expect(source).toMatch(/^'use server'/m)
  })
})

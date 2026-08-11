import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tenant as demoTenant } from '@/lib/data/mock/fixtures'
import { HelmApiError } from '@/lib/server/helm-api-errors'

// vi.hoisted: the static import of the module under test makes the mock
// factories run before ordinary consts would initialize.
const { listTenantsFromApi, isDemoMode, cookies } = vi.hoisted(() => ({
  listTenantsFromApi: vi.fn(),
  isDemoMode: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock('@/lib/server/tenant-directory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/tenant-directory')>('@/lib/server/tenant-directory')
  return { ...actual, listTenantsFromApi: (...args: unknown[]) => listTenantsFromApi(...args) }
})
vi.mock('@/lib/server/env', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/env')>('@/lib/server/env')
  return { ...actual, isDemoMode: () => isDemoMode() }
})
vi.mock('next/headers', () => ({ cookies }))

import { loadShellData, NoMembershipError } from '@/lib/server/shell-data'

const ACME = { id: 'uuid-acme', slug: 'acme', name: 'Acme' }
const BETA = { id: 'uuid-beta', slug: 'beta', name: 'Beta Corp' }
const metaFor = (t: { id: string; slug: string }, role = 'agency_admin') => ({
  tenantId: t.id,
  tenantSlug: t.slug,
  role,
  scopes: ['tenant:read'],
})

function setCookie(hint?: string) {
  cookies.mockResolvedValue({ get: (name: string) => (hint && name === 'helm_active_tenant' ? { value: hint } : undefined) })
}

beforeEach(() => {
  listTenantsFromApi.mockReset()
  isDemoMode.mockReset().mockReturnValue(false)
  cookies.mockReset()
  setCookie(undefined)
})

describe('loadShellData', () => {
  it('serves the fixture tenant in demo mode without calling the API', async () => {
    isDemoMode.mockReturnValue(true)

    const shell = await loadShellData()
    expect(shell.value).toEqual({ tenant: demoTenant, role: 'master' })
    expect(shell.switcher).toEqual({})
    expect(listTenantsFromApi).not.toHaveBeenCalled()
  })

  it('builds the tenant value from the API directory for a single membership', async () => {
    listTenantsFromApi.mockResolvedValue({ tenants: [ACME], meta: metaFor(ACME) })

    const shell = await loadShellData()
    // Tenant.id is the slug by convention; the display name comes from the
    // matching directory row; the role is mapped canonical -> UI.
    expect(shell.value?.tenant.id).toBe('acme')
    expect(shell.value?.tenant.name).toBe('Acme')
    expect(shell.value?.role).toBe('agency')
    expect(shell.switcher).toEqual({})
  })

  it('exposes the switcher (UUID-keyed) only when there is more than one membership', async () => {
    listTenantsFromApi.mockResolvedValue({ tenants: [ACME, BETA], meta: metaFor(ACME, 'owner') })

    const shell = await loadShellData()
    expect(shell.value?.role).toBe('master')
    expect(shell.switcher.activeId).toBe('uuid-acme')
    expect(shell.switcher.tenants).toEqual([
      { tenantId: 'uuid-acme', slug: 'acme', name: 'Acme' },
      { tenantId: 'uuid-beta', slug: 'beta', name: 'Beta Corp' },
    ])
  })

  it('forwards the helm_active_tenant cookie as the tenant hint', async () => {
    setCookie('uuid-beta')
    listTenantsFromApi.mockResolvedValue({ tenants: [BETA], meta: metaFor(BETA) })

    await loadShellData()
    expect(listTenantsFromApi).toHaveBeenCalledTimes(1)
    expect(listTenantsFromApi).toHaveBeenCalledWith({ tenantHint: 'uuid-beta' })
  })

  /**
   * FastAPI answers an unmatched hint with `no_membership` (deliberately
   * indistinguishable from having none), so a stale cookie must trigger one
   * retry without the hint rather than locking a legitimate member out.
   */
  it('retries once without the hint when a hinted lookup comes back empty', async () => {
    setCookie('uuid-revoked')
    listTenantsFromApi
      .mockResolvedValueOnce({ tenants: [], meta: null })
      .mockResolvedValueOnce({ tenants: [ACME], meta: metaFor(ACME) })

    const shell = await loadShellData()
    expect(shell.value?.tenant.id).toBe('acme')
    expect(listTenantsFromApi).toHaveBeenNthCalledWith(1, { tenantHint: 'uuid-revoked' })
    expect(listTenantsFromApi).toHaveBeenNthCalledWith(2)
  })

  it('throws NoMembershipError when the caller genuinely has no tenants', async () => {
    listTenantsFromApi.mockResolvedValue({ tenants: [], meta: null })

    await expect(loadShellData()).rejects.toBeInstanceOf(NoMembershipError)
    expect(listTenantsFromApi).toHaveBeenCalledTimes(1) // no hint was sent, so no retry
  })

  it('fails loud on an unknown role rather than defaulting', async () => {
    listTenantsFromApi.mockResolvedValue({ tenants: [ACME], meta: metaFor(ACME, 'superuser') })

    await expect(loadShellData()).rejects.toThrow(/Unknown canonical role/)
  })

  it('propagates API outages untouched -- an outage must never render as no-access', async () => {
    listTenantsFromApi.mockRejectedValue(new HelmApiError(503, 'upstream_unreachable', true))

    await expect(loadShellData()).rejects.toBeInstanceOf(HelmApiError)
  })
})

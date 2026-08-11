import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HelmApiError } from '@/lib/server/helm-api-errors'
import { UnauthenticatedError } from '@/lib/server/tenant-directory'

const loadShellData = vi.fn()
const redirect = vi.fn((target: string) => {
  // Real next/navigation redirect() throws; the sentinel keeps control flow
  // faithful so code after redirect() must not run.
  throw new Error(`REDIRECT:${target}`)
})

vi.mock('@/lib/server/shell-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/shell-data')>('@/lib/server/shell-data')
  return { ...actual, loadShellData: (...args: unknown[]) => loadShellData(...args) }
})
vi.mock('next/navigation', () => ({ redirect: (target: string) => redirect(target) }))

import AppLayout from '@/app/(app)/layout'
import { NoMembershipError } from '@/lib/server/shell-data'

beforeEach(() => {
  loadShellData.mockReset()
  redirect.mockClear()
})

/**
 * The redirect targets are contract: no membership and the API's
 * tenant_context_required both land on /no-access, a mid-request session
 * expiry lands on /login, and an outage propagates to the error boundary --
 * it must never be dressed up as revoked access.
 */
describe('AppLayout error routing', () => {
  it('redirects to /no-access when the caller has no membership', async () => {
    loadShellData.mockRejectedValue(new NoMembershipError())
    await expect(AppLayout({ children: null })).rejects.toThrow('REDIRECT:/no-access')
  })

  it('redirects to /login when the session expired mid-request', async () => {
    loadShellData.mockRejectedValue(new UnauthenticatedError())
    await expect(AppLayout({ children: null })).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects to /no-access on tenant_context_required (multi-membership without a hint)', async () => {
    loadShellData.mockRejectedValue(new HelmApiError(400, 'tenant_context_required', false))
    await expect(AppLayout({ children: null })).rejects.toThrow('REDIRECT:/no-access')
  })

  it('lets an outage propagate to the error boundary instead of redirecting', async () => {
    const outage = new HelmApiError(503, 'upstream_unreachable', true)
    loadShellData.mockRejectedValue(outage)
    await expect(AppLayout({ children: null })).rejects.toBe(outage)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('renders the provider tree when shell data resolves', async () => {
    loadShellData.mockResolvedValue({ value: undefined, switcher: {} })
    const tree = await AppLayout({ children: null })
    expect(tree).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})

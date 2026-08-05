import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HelmApiError } from '@/lib/server/helm-api-errors'

const helmApiGet = vi.fn()
const getServerSession = vi.fn()

vi.mock('@/lib/server/helm-api-client', () => ({ helmApiGet }))
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/auth', () => ({ authOptions: {} }))

beforeEach(() => {
  helmApiGet.mockReset()
  getServerSession.mockReset()
})

async function subject() {
  return (await import('@/lib/server/tenant-directory')).listTenantsFromApi
}

describe('listTenantsFromApi', () => {
  it('returns the tenants the API reports', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({
      data: [{ id: 'id-1', slug: 'acme', name: 'Acme', role: 'owner' }],
    })

    const list = await (await subject())()
    expect(list).toEqual([{ id: 'id-1', slug: 'acme', name: 'Acme', role: 'owner' }])
  })

  it('passes the session access token to the client', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({ data: [] })

    await (await subject())()
    expect(helmApiGet).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/tenants', accessToken: 'token-value' }),
    )
  })

  it('returns an empty list when the caller has no membership', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(403, 'no_membership', false))

    await expect((await subject())()).resolves.toEqual([])
  })

  it('refuses to call the API without an access token', async () => {
    getServerSession.mockResolvedValue({ user: {} })

    await expect((await subject())()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })

  it('propagates an unexpected API failure rather than hiding it as empty', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(503, 'upstream_unreachable', true))

    await expect((await subject())()).rejects.toBeInstanceOf(HelmApiError)
  })
})

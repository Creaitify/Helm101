import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HelmApiError } from '@/lib/server/helm-api-errors'

const helmApiGet = vi.fn()
const getToken = vi.fn()
const cookies = vi.fn()
const headers = vi.fn()

vi.mock('@/lib/server/helm-api-client', () => ({ helmApiGet }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('next/headers', () => ({ cookies, headers }))

beforeEach(() => {
  helmApiGet.mockReset()
  getToken.mockReset()
  cookies.mockReset().mockResolvedValue({ getAll: () => [] })
  headers.mockReset().mockResolvedValue(new Headers())
})

async function subject() {
  return (await import('@/lib/server/tenant-directory')).listTenantsFromApi
}

describe('listTenantsFromApi', () => {
  it('returns the tenants the API reports', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({
      data: [{ id: 'id-1', slug: 'acme', name: 'Acme', role: 'owner' }],
    })

    const list = await (await subject())()
    expect(list).toEqual([{ id: 'id-1', slug: 'acme', name: 'Acme', role: 'owner' }])
  })

  it('passes the access token from the encrypted cookie to the client', async () => {
    const listTenantsFromApi = await subject()

    getToken.mockResolvedValue({ accessToken: 'token-alpha' })
    helmApiGet.mockResolvedValue({ data: [] })
    await listTenantsFromApi()
    expect(helmApiGet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: '/api/v1/tenants', accessToken: 'token-alpha' }),
    )

    getToken.mockResolvedValue({ accessToken: 'token-beta' })
    helmApiGet.mockResolvedValue({ data: [] })
    await listTenantsFromApi()
    expect(helmApiGet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: '/api/v1/tenants', accessToken: 'token-beta' }),
    )
  })

  /**
   * The credential must come from the JWT in the encrypted cookie, never from
   * `getServerSession()` -- that object is served verbatim to the browser at
   * `GET /api/auth/session`, so a token readable from it is a token readable by
   * any script on the page.
   */
  it('reads the token from the request cookies, not from a session response body', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({ data: [] })

    await (await subject())()

    expect(getToken).toHaveBeenCalledTimes(1)
    const [params] = getToken.mock.calls[0] as [{ req: { cookies: unknown; headers: unknown } }]
    expect(params.req.cookies).toBe(await cookies.mock.results[0].value)
    expect(params.req.headers).toBe(await headers.mock.results[0].value)
  })

  it('returns an empty list when the caller has no membership', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(403, 'no_membership', false))

    await expect((await subject())()).resolves.toEqual([])
  })

  it('refuses to call the API without an access token', async () => {
    getToken.mockResolvedValue({ sub: 'auth0|abc123' })

    await expect((await subject())()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })

  it('refuses to call the API when there is no session cookie at all', async () => {
    getToken.mockResolvedValue(null)

    await expect((await subject())()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })

  it('propagates an unexpected API failure rather than hiding it as empty', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(503, 'upstream_unreachable', true))

    await expect((await subject())()).rejects.toBeInstanceOf(HelmApiError)
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HelmApiError } from '@/lib/server/helm-api-errors'
import { UnauthenticatedError } from '@/lib/server/tenant-directory'

// vi.hoisted: the static import of the module under test (for the typed
// error class) makes the mock factories run before ordinary consts would
// initialize.
const { helmApiGet, getToken, cookies, headers } = vi.hoisted(() => ({
  helmApiGet: vi.fn(),
  getToken: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
}))

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

const API_META = {
  tenant_id: 'id-1',
  tenant_slug: 'acme',
  role: 'owner',
  scopes: ['tenant:read'],
}

describe('listTenantsFromApi', () => {
  it('returns the tenants and camelCased context meta the API reports', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({
      data: [{ id: 'id-1', slug: 'acme', name: 'Acme' }],
      meta: API_META,
    })

    const directory = await (await subject())()
    expect(directory).toEqual({
      tenants: [{ id: 'id-1', slug: 'acme', name: 'Acme' }],
      meta: { tenantId: 'id-1', tenantSlug: 'acme', role: 'owner', scopes: ['tenant:read'] },
    })
  })

  it('returns meta: null when the API omits the meta block', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({ data: [] })

    await expect((await subject())()).resolves.toEqual({ tenants: [], meta: null })
  })

  it('forwards a tenant hint as the X-HELM-Active-Tenant input', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({ data: [], meta: API_META })

    await (await subject())({ tenantHint: 'acme' })
    expect(helmApiGet).toHaveBeenCalledWith(expect.objectContaining({ tenantHint: 'acme' }))
  })

  it('sends no hint when none is provided', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({ data: [], meta: API_META })

    await (await subject())()
    expect(helmApiGet).toHaveBeenCalledWith(expect.objectContaining({ tenantHint: undefined }))
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

  it('returns an empty directory when the caller has no membership', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(403, 'no_membership', false))

    await expect((await subject())()).resolves.toEqual({ tenants: [], meta: null })
  })

  it('refuses to call the API without an access token, with a typed error', async () => {
    getToken.mockResolvedValue({ sub: 'auth0|abc123' })

    await expect((await subject())()).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(helmApiGet).not.toHaveBeenCalled()
  })

  it('refuses to call the API when there is no session cookie at all', async () => {
    getToken.mockResolvedValue(null)

    await expect((await subject())()).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(helmApiGet).not.toHaveBeenCalled()
  })

  it('propagates an unexpected API failure rather than hiding it as empty', async () => {
    getToken.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(503, 'upstream_unreachable', true))

    await expect((await subject())()).rejects.toBeInstanceOf(HelmApiError)
  })
})

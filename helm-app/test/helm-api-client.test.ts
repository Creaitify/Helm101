import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { HelmApiError as HelmApiErrorType } from '@/lib/server/helm-api-errors'

const fetchMock = vi.fn()

/**
 * `helm-api-client.ts` resolves its base URL through `env.ts`, which snapshots
 * `process.env` once at module-evaluation time. To make a per-test
 * `process.env.HELM_API_BASE_URL` change actually take effect, both `env.ts`
 * and `helm-api-client.ts` must be re-imported fresh after the env var is set
 * — the same pattern `test/env-auth0.test.ts` uses for `env.ts` directly.
 */
async function loadClient(values: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const [{ helmApiGet }, { HelmApiError }] = await Promise.all([
    import('@/lib/server/helm-api-client'),
    import('@/lib/server/helm-api-errors'),
  ])
  return { helmApiGet, HelmApiError }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('helmApiGet', () => {
  it('sends the access token as a bearer credential', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 'token-value' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer token-value')
  })

  it('sends the tenant hint header only when a hint is given', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't', tenantHint: 'acme' })
    expect(fetchMock.mock.calls[0][1].headers['X-HELM-Active-Tenant']).toBe('acme')

    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[1][1].headers['X-HELM-Active-Tenant']).toBeUndefined()
  })

  it('joins the base URL and path without duplicating slashes', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test/' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/tenants')
  })

  it('returns the parsed body on success', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ slug: 'acme' }] }))
    const result = await helmApiGet<{ data: { slug: string }[] }>({
      path: '/api/v1/tenants',
      accessToken: 't',
    })
    expect(result.data[0].slug).toBe('acme')
  })

  it('throws a typed error for a problem response', async () => {
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'no_membership' }, 'application/problem+json'),
    )
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toBeInstanceOf(
      HelmApiError,
    )
  })

  it('never lets an upstream body reach the thrown error', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(new Response('postgres://user:pw@host/db', { status: 500 }))
    await expect(
      helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }),
    ).rejects.toSatisfy((error: HelmApiErrorType) => !error.message.includes('postgres://'))
  })

  it('turns a network failure into a retryable typed error, not a raw throw', async () => {
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const error = await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(HelmApiError)
    expect((error as HelmApiErrorType).retryable).toBe(true)
  })

  it('refuses to call without a configured base URL', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: undefined })
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toThrow(
      /helmApiBaseUrl/,
    )
  })
})

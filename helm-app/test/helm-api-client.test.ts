import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { helmApiGet } from '@/lib/server/helm-api-client'
import { HelmApiError } from '@/lib/server/helm-api-errors'

const fetchMock = vi.fn()

beforeEach(() => {
  process.env.HELM_API_BASE_URL = 'http://api.test'
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('helmApiGet', () => {
  it('sends the access token as a bearer credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 'token-value' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer token-value')
  })

  it('sends the tenant hint header only when a hint is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't', tenantHint: 'acme' })
    expect(fetchMock.mock.calls[0][1].headers['X-HELM-Active-Tenant']).toBe('acme')

    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[1][1].headers['X-HELM-Active-Tenant']).toBeUndefined()
  })

  it('joins the base URL and path without duplicating slashes', async () => {
    process.env.HELM_API_BASE_URL = 'http://api.test/'
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/tenants')
  })

  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ slug: 'acme' }] }))
    const result = await helmApiGet<{ data: { slug: string }[] }>({
      path: '/api/v1/tenants',
      accessToken: 't',
    })
    expect(result.data[0].slug).toBe('acme')
  })

  it('throws a typed error for a problem response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'no_membership' }, 'application/problem+json'),
    )
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toBeInstanceOf(
      HelmApiError,
    )
  })

  it('never lets an upstream body reach the thrown error', async () => {
    fetchMock.mockResolvedValue(new Response('postgres://user:pw@host/db', { status: 500 }))
    await expect(
      helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }),
    ).rejects.toSatisfy((error: HelmApiError) => !error.message.includes('postgres://'))
  })

  it('turns a network failure into a retryable typed error, not a raw throw', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const error = await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(HelmApiError)
    expect((error as HelmApiError).retryable).toBe(true)
  })

  it('refuses to call without a configured base URL', async () => {
    delete process.env.HELM_API_BASE_URL
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toThrow(
      /helmApiBaseUrl/,
    )
  })
})

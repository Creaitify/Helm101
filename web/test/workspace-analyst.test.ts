import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GENERATION_TIMEOUT_MS } from '@/lib/server/helm-api-client'

const { helmApiPost, getToken, cookies, headers } = vi.hoisted(() => ({
  helmApiPost: vi.fn(),
  getToken: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('@/lib/server/helm-api-client', async (importOriginal) => ({
  // Real GENERATION_TIMEOUT_MS, mocked transport: the test asserts the
  // analyst passes the documented budget, not a copy of its value.
  ...(await importOriginal<typeof import('@/lib/server/helm-api-client')>()),
  helmApiPost,
}))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('next/headers', () => ({ cookies, headers }))

import { askAnalystFromApi } from '@/lib/server/workspace-analyst'
import { UnauthenticatedError } from '@/lib/server/session-token'
import { allowLocalAnalyst } from '@/lib/server/env'

const RESPONSE = {
  data: 'Create the helm-api API in the Auth0 tenant.',
  citations: [
    { label: 'PENDING.md § sign-in', source: 'platform docs', doc: 'PENDING.md', heading: 'x', quote: 'q', start_line: 1 },
  ],
  meta: { grounded: true, source: 'platform_docs', tenant_scoped: false },
}

beforeEach(() => {
  helmApiPost.mockReset().mockResolvedValue(RESPONSE)
  getToken.mockReset().mockResolvedValue({ accessToken: 'token-value' })
  cookies.mockReset().mockResolvedValue({ getAll: () => [], get: () => undefined })
  headers.mockReset().mockResolvedValue(new Headers())
})

describe('askAnalystFromApi', () => {
  it('POSTs the question with the bearer token and the generation timeout', async () => {
    await askAnalystFromApi('what blocks sign-in?')
    expect(helmApiPost).toHaveBeenCalledTimes(1)
    const request = helmApiPost.mock.calls[0][0]
    expect(request.path).toBe('/api/v1/workspace/questions')
    expect(request.accessToken).toBe('token-value')
    expect(request.body).toEqual({ question: 'what blocks sign-in?', history: [] })
    expect(request.timeoutMs).toBe(GENERATION_TIMEOUT_MS)
    // One idempotency key per ask, so a transport retry deduplicates.
    expect(request.idempotencyKey).toMatch(/[0-9a-f-]{36}/)
  })

  it('forwards the active-tenant cookie as the hint, and omits it when absent', async () => {
    cookies.mockResolvedValue({ getAll: () => [], get: (name: string) => (name === 'helm_active_tenant' ? { value: 'acme' } : undefined) })
    await askAnalystFromApi('q')
    expect(helmApiPost.mock.calls[0][0].tenantHint).toBe('acme')

    cookies.mockResolvedValue({ getAll: () => [], get: () => undefined })
    await askAnalystFromApi('q')
    expect(helmApiPost.mock.calls[1][0].tenantHint).toBeUndefined()
  })

  it('maps the wire shape down to what the UI renders', async () => {
    const answer = await askAnalystFromApi('q')
    expect(answer).toEqual({
      text: 'Create the helm-api API in the Auth0 tenant.',
      citations: [{ label: 'PENDING.md § sign-in', source: 'platform docs' }],
      grounded: true,
    })
  })

  it('reports an ungrounded answer as ungrounded', async () => {
    helmApiPost.mockResolvedValue({ ...RESPONSE, citations: [], meta: { ...RESPONSE.meta, grounded: false } })
    const answer = await askAnalystFromApi('q')
    expect(answer.grounded).toBe(false)
    expect(answer.citations).toEqual([])
  })

  it('throws UnauthenticatedError when there is no decodable session', async () => {
    getToken.mockResolvedValue(null)
    await expect(askAnalystFromApi('q')).rejects.toBeInstanceOf(UnauthenticatedError)
    expect(helmApiPost).not.toHaveBeenCalled()
  })
})

/**
 * ALLOW_LOCAL_ANALYST — the web counterpart of the API's
 * ALLOW_LOCAL_PRINCIPAL. env.ts reads process.env per call, so these tests
 * set and restore the raw variables.
 */
describe('local-analyst mode', () => {
  const saved = {
    ALLOW_LOCAL_ANALYST: process.env.ALLOW_LOCAL_ANALYST,
    HELM_API_BASE_URL: process.env.HELM_API_BASE_URL,
    HELM_ENV: process.env.HELM_ENV,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('asks without a session, using the placeholder the API never reads', async () => {
    process.env.ALLOW_LOCAL_ANALYST = 'true'
    process.env.HELM_API_BASE_URL = 'http://api.test'
    delete process.env.HELM_ENV
    getToken.mockResolvedValue(null)

    await askAnalystFromApi('q')
    expect(helmApiPost.mock.calls[0][0].accessToken).toBe('local-principal')
  })

  it('is inert without a configured API base URL', () => {
    process.env.ALLOW_LOCAL_ANALYST = 'true'
    delete process.env.HELM_API_BASE_URL
    expect(allowLocalAnalyst()).toBe(false)
  })

  it('refuses loudly in staging and production, mirroring the API guard', () => {
    process.env.ALLOW_LOCAL_ANALYST = 'true'
    process.env.HELM_API_BASE_URL = 'http://api.test'
    for (const appEnv of ['staging', 'production']) {
      process.env.HELM_ENV = appEnv
      expect(() => allowLocalAnalyst()).toThrow(/never be enabled/)
    }
  })
})

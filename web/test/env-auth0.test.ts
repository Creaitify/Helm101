import { describe, expect, it, vi, afterEach } from 'vitest'

async function loadEnv(values: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return await import('@/lib/server/env')
}

afterEach(() => {
  vi.resetModules()
})

describe('Auth0 environment contract', () => {
  it('exposes every Auth0 value the provider needs', async () => {
    const { env } = await loadEnv({
      AUTH0_ISSUER: 'https://helm.eu.auth0.com',
      AUTH0_CLIENT_ID: 'client-id',
      AUTH0_CLIENT_SECRET: 'client-secret',
      AUTH0_AUDIENCE: 'helm-api',
      HELM_API_BASE_URL: 'http://localhost:8000',
    })
    expect(env.auth0Issuer).toBe('https://helm.eu.auth0.com')
    expect(env.auth0ClientId).toBe('client-id')
    expect(env.auth0ClientSecret).toBe('client-secret')
    expect(env.auth0Audience).toBe('helm-api')
    expect(env.helmApiBaseUrl).toBe('http://localhost:8000')
  })

  it('reports absent values as undefined rather than empty strings', async () => {
    const { env } = await loadEnv({
      AUTH0_ISSUER: '   ',
      AUTH0_CLIENT_ID: undefined,
      AUTH0_CLIENT_SECRET: undefined,
      AUTH0_AUDIENCE: undefined,
      HELM_API_BASE_URL: undefined,
    })
    expect(env.auth0Issuer).toBeUndefined()
    expect(env.auth0ClientId).toBeUndefined()
  })

  it('requireServerEnv throws a named error for a missing FastAPI base URL', async () => {
    const { requireServerEnv } = await loadEnv({ HELM_API_BASE_URL: undefined })
    expect(() => requireServerEnv('helmApiBaseUrl')).toThrow(/helmApiBaseUrl/)
  })
})

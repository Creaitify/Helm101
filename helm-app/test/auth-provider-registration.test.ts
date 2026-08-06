import { describe, expect, it, vi, afterEach } from 'vitest'
import type { OAuthConfig } from 'next-auth/providers/oauth'

const AUTH0_ENV = {
  AUTH0_ISSUER: 'https://helm.eu.auth0.com',
  AUTH0_CLIENT_ID: 'client-id-value',
  AUTH0_CLIENT_SECRET: 'client-secret-value',
  AUTH0_AUDIENCE: 'helm-api',
}

const KEYS = [
  'AUTH0_ISSUER',
  'AUTH0_CLIENT_ID',
  'AUTH0_CLIENT_SECRET',
  'AUTH0_AUDIENCE',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
  'AUTH_MICROSOFT_ENTRA_ID_ID',
  'AUTH_MICROSOFT_ENTRA_ID_SECRET',
] as const

const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

async function loadAuthOptions(values: Record<string, string | undefined>) {
  vi.resetModules()
  for (const key of KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }
  return (await import('@/auth')).authOptions
}

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

function auth0Provider(providers: unknown[]) {
  return providers.find((p) => (p as { id?: string }).id === 'auth0') as
    | OAuthConfig<Record<string, unknown>>
    | undefined
}

describe('Auth0 provider registration', () => {
  it('registers Auth0 when the issuer, client id, and secret are all present', async () => {
    const options = await loadAuthOptions(AUTH0_ENV)
    const provider = auth0Provider(options.providers)

    expect(provider).toBeDefined()
    expect(provider!.options?.issuer).toBe('https://helm.eu.auth0.com')
    expect(provider!.options?.clientId).toBe('client-id-value')
  })

  it('requests the API audience, without which Auth0 issues an unverifiable opaque token', async () => {
    const options = await loadAuthOptions(AUTH0_ENV)
    const provider = auth0Provider(options.providers)
    const params = (
      provider!.options?.authorization as { params?: Record<string, unknown> } | undefined
    )?.params

    expect(params?.audience).toBe('helm-api')
    expect(params?.scope).toBe('openid profile email')
  })

  // AUTH0_AUDIENCE belongs in this list, not only in the params. Registering
  // without it sends `audience: undefined`, which Auth0 answers with an opaque
  // token that has no `aud` claim and cannot be verified against the JWKS --
  // a silent misconfiguration that only surfaces as a 401 at first login.
  for (const missing of [
    'AUTH0_ISSUER',
    'AUTH0_CLIENT_ID',
    'AUTH0_CLIENT_SECRET',
    'AUTH0_AUDIENCE',
  ] as const) {
    it(`does not register Auth0 when ${missing} is absent`, async () => {
      const partial = { ...AUTH0_ENV, [missing]: undefined }
      const options = await loadAuthOptions(partial)

      expect(auth0Provider(options.providers)).toBeUndefined()
    })
  }

  it('leaves the pre-existing Google and Microsoft registrations intact', async () => {
    const options = await loadAuthOptions({
      ...AUTH0_ENV,
      AUTH_GOOGLE_ID: 'google-id',
      AUTH_GOOGLE_SECRET: 'google-secret',
      AUTH_MICROSOFT_ENTRA_ID_ID: 'ms-id',
      AUTH_MICROSOFT_ENTRA_ID_SECRET: 'ms-secret',
    })
    const ids = options.providers.map((p) => (p as { id?: string }).id)

    expect(ids).toEqual(expect.arrayContaining(['google', 'azure-ad', 'auth0']))
  })

  it('never exposes the client secret through a provider id or name', async () => {
    const options = await loadAuthOptions(AUTH0_ENV)
    const provider = auth0Provider(options.providers)

    expect(provider!.id).toBe('auth0')
    expect(provider!.name).not.toContain('client-secret-value')
  })
})

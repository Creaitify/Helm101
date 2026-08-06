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

  /**
   * Collect every path in `value` whose string content contains `needle`.
   *
   * Walking the whole object matters: the previous version of the test below
   * asserted only on `provider.id` and `provider.name`, which are NextAuth's
   * own constants ('auth0'/'Auth0'). Nothing in this branch sets them, so the
   * assertion could not fail for the reason its name claimed — injecting the
   * real secret into the provider name survived it.
   */
  function pathsContaining(value: unknown, needle: string, path = ''): string[] {
    if (typeof value === 'string') return value.includes(needle) ? [path] : []
    if (typeof value === 'function') return []
    if (value === null || typeof value !== 'object') return []
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      pathsContaining(child, needle, path ? `${path}.${key}` : key),
    )
  }

  // The secret is SUPPOSED to be at options.clientSecret — that is the field
  // NextAuth exchanges the authorization code with, server-side, and a provider
  // without it cannot complete a login. So "the secret appears nowhere" would be
  // a false claim. What must hold is that it appears at that one place and
  // nowhere else: any second occurrence is a copy in a field with different
  // exposure (`id` and `name` are rendered into the sign-in page, `authorization`
  // is serialized into the URL the browser is redirected to).
  it('carries the client secret at exactly one path, options.clientSecret', async () => {
    const options = await loadAuthOptions(AUTH0_ENV)
    const provider = auth0Provider(options.providers)

    const paths = pathsContaining(provider, 'client-secret-value')

    // Positive control: the walk really can find the secret. Without this the
    // assertion below would pass just as happily against a broken walker that
    // returned [] for everything.
    expect(paths).toContain('options.clientSecret')
    expect(paths).toEqual(['options.clientSecret'])
  })

  it('does not put the client secret in the authorization request sent to the browser', async () => {
    const options = await loadAuthOptions(AUTH0_ENV)
    const provider = auth0Provider(options.providers)

    // Narrower restatement of the above, aimed at the specific field that
    // crosses the trust boundary: `authorization` becomes the query string of
    // the redirect the user's browser follows.
    const authorization = JSON.stringify(provider!.options?.authorization ?? null)
    expect(authorization).not.toContain('client-secret-value')
    // Non-vacuous: `authorization` is a populated object, not null/undefined,
    // so the assertion above is examining real content.
    expect(authorization).toContain('helm-api')
  })
})

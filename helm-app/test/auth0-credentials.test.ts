/**
 * The password-grant exchange. Every test here is on a credential path.
 *
 * Two properties dominate: a password must not escape into any observable, and
 * a failure must not reveal which failure it was. The tests assert on what was
 * actually sent to Auth0 (URL, grant type, realm) rather than merely that the
 * fetch stub was called, so an implementation that calls the wrong endpoint or
 * the unpinned `password` grant fails.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const AUTH0_ENV = {
  AUTH0_ISSUER: 'https://helm.eu.auth0.com',
  AUTH0_CLIENT_ID: 'client-id-value',
  AUTH0_CLIENT_SECRET: 'client-secret-value',
  AUTH0_AUDIENCE: 'helm-api',
}

const KEYS = Object.keys(AUTH0_ENV) as (keyof typeof AUTH0_ENV)[]
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

/** Distinctive and non-substitutable, so a leak anywhere is unmistakable. */
const PASSWORD = 'correct-horse-battery-staple-9271'
const ACCESS_TOKEN = 'access-token-alpha'
const ID_TOKEN_SUBJECT = 'auth0|abc123'

/** A real three-segment JWT whose payload carries `sub`. Not a stub string. */
function idTokenFor(sub: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64({ sub, email: 'user@example.com' })}.signature-not-verified`
}

const ID_TOKEN = idTokenFor(ID_TOKEN_SUBJECT)

function tokenResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

async function loadModule(values: Record<string, string | undefined> = AUTH0_ENV) {
  vi.resetModules()
  for (const key of KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }
  return await import('@/lib/server/auth0-credentials')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

describe('the request sent to Auth0', () => {
  it('posts the realm-pinned password grant to the token endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenResponse({ access_token: ACCESS_TOKEN, id_token: ID_TOKEN }))

    const { exchangePasswordForTokens, PASSWORD_REALM_GRANT, REALM } = await loadModule()
    await exchangePasswordForTokens('user@example.com', PASSWORD)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]

    // The exact endpoint, not a substring: '/oauth/token' appearing somewhere in
    // a wrong URL would satisfy a looser check.
    expect(url).toBe('https://helm.eu.auth0.com/oauth/token')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string)
    // The realm grant specifically. The plain `password` grant would also
    // authenticate, which is exactly why this is asserted by exact value: it
    // lets Auth0 choose the connection.
    expect(body.grant_type).toBe(PASSWORD_REALM_GRANT)
    expect(body.grant_type).toBe('http://auth0.com/oauth/grant-type/password-realm')
    expect(body.realm).toBe(REALM)
    expect(body.realm).toBe('Username-Password-Authentication')
    expect(body.audience).toBe('helm-api')
    expect(body.scope).toBe('openid profile email')
    expect(body.client_id).toBe('client-id-value')
    expect(body.username).toBe('user@example.com')
  })

  it('returns the access token and the subject from the id token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: ACCESS_TOKEN, id_token: ID_TOKEN, expires_in: 3600 }),
    )

    const { exchangePasswordForTokens } = await loadModule()
    const result = await exchangePasswordForTokens('user@example.com', PASSWORD)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.accessToken).toBe(ACCESS_TOKEN)
    // From the ID token's `sub` claim -- not the submitted email, which is
    // never an identity key.
    expect(result.subject).toBe(ID_TOKEN_SUBJECT)
    expect(result.subject).not.toBe('user@example.com')
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('never sends the password anywhere but the token request body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenResponse({ access_token: ACCESS_TOKEN, id_token: ID_TOKEN }))

    const { exchangePasswordForTokens } = await loadModule()
    await exchangePasswordForTokens('user@example.com', PASSWORD)

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    // Not in the URL (where it would reach access logs and Referer headers).
    expect(url).not.toContain(PASSWORD)
    // Not in the headers.
    expect(JSON.stringify(init.headers)).not.toContain(PASSWORD)
    // Positive control: the walk above can see the password at all. Without
    // this, the assertions would pass against a request that sent no password
    // and could not possibly authenticate.
    expect(init.body as string).toContain(PASSWORD)
  })

  it('does not fabricate a token when Auth0 returns only an id token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse({ id_token: ID_TOKEN }))

    const { exchangePasswordForTokens } = await loadModule()
    const result = await exchangePasswordForTokens('user@example.com', PASSWORD)

    // Falling back to the ID token is the defect this guards: it verifies
    // against the same JWKS and then fails on `aud`.
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(ID_TOKEN)
  })

  it('fails when the id token carries no subject, rather than keying on email', async () => {
    const noSub = `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ email: 'user@example.com' })).toString('base64url')}.sig`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: ACCESS_TOKEN, id_token: noSub }),
    )

    const { exchangePasswordForTokens } = await loadModule()
    const result = await exchangePasswordForTokens('user@example.com', PASSWORD)

    expect(result.ok).toBe(false)
  })

  it('does not call Auth0 at all when the config is incomplete', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { exchangePasswordForTokens } = await loadModule({
      ...AUTH0_ENV,
      AUTH0_AUDIENCE: undefined,
    })
    const result = await exchangePasswordForTokens('user@example.com', PASSWORD)

    expect(result.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('failures are indistinguishable', () => {
  /**
   * The enumeration assertion. Auth0 answers both of these with 401 but with
   * different `error_description` text; if any of that reached the caller, an
   * anonymous visitor could test an address for existence.
   */
  it('answers a wrong password and an unknown account identically', async () => {
    const wrongPassword = {
      error: 'invalid_grant',
      error_description: 'Wrong email or password.',
    }
    const noSuchUser = {
      error: 'invalid_grant',
      error_description: 'user does not exist in connection Username-Password-Authentication',
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse(wrongPassword, 401))
    const mod = await loadModule()
    const wrong = await mod.exchangePasswordForTokens('known@example.com', PASSWORD)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse(noSuchUser, 401))
    const unknown = await mod.exchangePasswordForTokens('nobody@example.com', PASSWORD)

    // Deep equality over the entire result, so a distinguishing field added at
    // any key is caught -- not just a differing `ok`.
    expect(wrong).toEqual(unknown)
    expect(wrong).toEqual({ ok: false })
  })

  it('never surfaces Auth0 error text, for any failure shape', async () => {
    const bodies = [
      { error: 'invalid_grant', error_description: 'Wrong email or password.' },
      {
        error: 'invalid_grant',
        error_description: 'user does not exist in connection Username-Password-Authentication',
      },
      { error: 'too_many_attempts', error_description: 'Your account has been blocked' },
      { error: 'unauthorized_client', error_description: 'Grant type not allowed for the client' },
    ]

    const mod = await loadModule()
    for (const body of bodies) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse(body, 403))
      const result = await mod.exchangePasswordForTokens('user@example.com', PASSWORD)

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(body.error)
      expect(serialized).not.toContain(body.error_description)
      expect(serialized).not.toContain(PASSWORD)
      expect(result).toEqual({ ok: false })
    }
  })

  it('reveals nothing when the network call throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error(`connect ECONNREFUSED for user with password ${PASSWORD}`),
    )

    const { exchangePasswordForTokens } = await loadModule()
    const result = await exchangePasswordForTokens('user@example.com', PASSWORD)

    expect(result).toEqual({ ok: false })
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
  })

  it('rejects a malformed email and a short password without calling Auth0', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { exchangePasswordForTokens } = await loadModule()

    expect(await exchangePasswordForTokens('not-an-email', PASSWORD)).toEqual({ ok: false })
    expect(await exchangePasswordForTokens('user@example.com', 'short')).toEqual({ ok: false })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('validation helpers', () => {
  it('accepts real addresses and rejects malformed ones', async () => {
    const { isValidEmail } = await loadModule()

    // Both branches exercised: a fixture that was uniformly valid or uniformly
    // invalid could not distinguish a working validator from a constant.
    for (const good of ['user@example.com', 'a.b+tag@sub.example.co.uk']) {
      expect(isValidEmail(good), good).toBe(true)
    }
    for (const bad of ['', 'no-at-sign', 'user@nodot', 'user @example.com', 'a@b@c.com', null]) {
      expect(isValidEmail(bad as unknown as string), String(bad)).toBe(false)
    }
  })

  it('enforces the minimum password length at the boundary', async () => {
    const { isValidPassword, MIN_PASSWORD_LENGTH } = await loadModule()

    expect(isValidPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false)
    expect(isValidPassword('x'.repeat(MIN_PASSWORD_LENGTH))).toBe(true)
    expect(isValidPassword(undefined)).toBe(false)
  })

  it('parses the subject from a real base64url payload', async () => {
    const { subjectFromIdToken } = await loadModule()

    expect(subjectFromIdToken(idTokenFor('auth0|xyz789'))).toBe('auth0|xyz789')
    expect(subjectFromIdToken('not.a.jwt')).toBeNull()
    expect(subjectFromIdToken('only-one-segment')).toBeNull()
    expect(subjectFromIdToken(undefined)).toBeNull()
  })
})

/**
 * Signup: local validation, Auth0 error translation, and the enumeration
 * decision. The load-bearing test here is that a duplicate address is
 * indistinguishable from a new one -- see the tradeoff note in
 * lib/server/auth0-signup.ts.
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

const PASSWORD = 'correct-horse-battery-staple-9271'

function jsonResponse(body: unknown, status = 200) {
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
  return await import('@/lib/server/auth0-signup')
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

describe('signup validation happens before any network call', () => {
  it('rejects a malformed email without calling Auth0', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { signupWithAuth0 } = await loadModule()

    const result = await signupWithAuth0('not-an-email', PASSWORD)

    expect(result).toEqual({ code: 'invalid_email', ok: false })
    // The point of validating locally: nothing reached a third party.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a too-short password without calling Auth0', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { signupWithAuth0 } = await loadModule()

    const result = await signupWithAuth0('user@example.com', 'short')

    expect(result).toEqual({ code: 'password_too_short', ok: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does call Auth0 when both values are valid', async () => {
    // The positive control for the two tests above. Without it, an
    // implementation that never calls fetch at all would pass both.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ _id: 'x' }, 200))
    const { signupWithAuth0 } = await loadModule()

    const result = await signupWithAuth0('user@example.com', PASSWORD)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ code: 'created', ok: true })
  })
})

describe('the request sent to Auth0', () => {
  it('posts to the dbconnections signup endpoint with the pinned connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ _id: 'x' }, 200))
    const { signupWithAuth0 } = await loadModule()

    await signupWithAuth0('user@example.com', PASSWORD)

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://helm.eu.auth0.com/dbconnections/signup')

    const body = JSON.parse(init.body as string)
    expect(body.connection).toBe('Username-Password-Authentication')
    expect(body.client_id).toBe('client-id-value')
    expect(body.email).toBe('user@example.com')
    // The client SECRET must not be here: /dbconnections/signup is a public
    // endpoint that takes client_id alone, and sending the secret would widen
    // its exposure for no benefit.
    expect(init.body as string).not.toContain('client-secret-value')
  })
})

describe('Auth0 errors are translated, never echoed', () => {
  /**
   * Each fixture is a real Auth0 signup error body, complete with the detail
   * that must not escape: the policy text, the connection name, the address.
   */
  const AUTH0_ERRORS = [
    {
      status: 400,
      body: {
        name: 'PasswordStrengthError',
        code: 'invalid_password',
        description: {
          rules: [{ message: 'At least %d characters in length', format: [8] }],
          verified: false,
        },
        policy: '* At least 8 characters in length',
        statusCode: 400,
      },
      expected: 'weak_password',
    },
    {
      status: 400,
      body: {
        name: 'BadRequestError',
        code: 'invalid_signup',
        description: 'Invalid sign up',
        statusCode: 400,
      },
      expected: 'created',
    },
    {
      status: 500,
      body: { name: 'InternalError', code: 'server_error', description: 'oops' },
      expected: 'unavailable',
    },
  ] as const

  it('maps each Auth0 error to one of our own codes', async () => {
    const { signupWithAuth0 } = await loadModule()

    for (const fixture of AUTH0_ERRORS) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(fixture.body, fixture.status))
      const result = await signupWithAuth0('user@example.com', PASSWORD)

      expect(result.code, JSON.stringify(fixture.body)).toBe(fixture.expected)
    }
  })

  it('never lets Auth0 body text into the result or the message shown', async () => {
    const { signupWithAuth0, SIGNUP_MESSAGES } = await loadModule()

    for (const fixture of AUTH0_ERRORS) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(fixture.body, fixture.status))
      const result = await signupWithAuth0('user@example.com', PASSWORD)

      // The whole result AND the message a caller would render.
      const visible = JSON.stringify(result) + SIGNUP_MESSAGES[result.code]

      // Every string anywhere in the Auth0 body, at any depth.
      for (const leaked of stringsIn(fixture.body)) {
        // Skip fragments too short to be meaningful evidence of an echo.
        if (leaked.length < 6) continue
        expect(visible, `echoed Auth0 text: ${leaked}`).not.toContain(leaked)
      }
      expect(visible).not.toContain(PASSWORD)
    }
  })

  it('collects the strings it claims to check', () => {
    // Positive control for the walker above: if `stringsIn` returned [], the
    // leak assertions would iterate zero times and pass unconditionally.
    const found = stringsIn(AUTH0_ERRORS[0].body)
    expect(found).toContain('PasswordStrengthError')
    expect(found).toContain('* At least 8 characters in length')
    expect(found.length).toBeGreaterThan(3)
  })
})

/** Every string value in a nested object, at any depth. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>).flatMap(stringsIn)
}

describe('the enumeration tradeoff', () => {
  /**
   * The decision this file exists to pin: a duplicate address is reported as
   * `created`, exactly as a genuinely new account is. Anything that
   * distinguishes them -- a different code, a different `ok`, a different
   * message -- is an oracle an anonymous caller can query with a list of
   * addresses.
   */
  it('reports a duplicate address exactly as it reports a new account', async () => {
    const { signupWithAuth0, SIGNUP_MESSAGES } = await loadModule()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ _id: 'new-user' }, 200))
    const fresh = await signupWithAuth0('nobody@example.com', PASSWORD)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          name: 'BadRequestError',
          code: 'user_exists',
          description: 'The user already exists.',
          statusCode: 400,
        },
        400,
      ),
    )
    const duplicate = await signupWithAuth0('known@example.com', PASSWORD)

    // Deep equality across the whole result: a distinguishing field at any key
    // fails here, not just a differing code.
    expect(duplicate).toEqual(fresh)
    expect(SIGNUP_MESSAGES[duplicate.code]).toBe(SIGNUP_MESSAGES[fresh.code])
    // And the word that would give it away appears nowhere.
    expect(SIGNUP_MESSAGES[duplicate.code].toLowerCase()).not.toContain('exist')
    expect(SIGNUP_MESSAGES[duplicate.code].toLowerCase()).not.toContain('already')
  })

  it('still distinguishes a weak password, which is safe to reveal', async () => {
    // The negative control. Without this, mapping EVERY error to `created`
    // would pass the test above -- and the user would never learn why a genuine
    // signup failed. A password policy message names no account holder.
    const { signupWithAuth0 } = await loadModule()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ name: 'PasswordStrengthError', code: 'invalid_password' }, 400),
    )
    const result = await signupWithAuth0('user@example.com', PASSWORD)

    expect(result).toEqual({ code: 'weak_password', ok: false })
  })

  it('maps user_exists to created at the mapping function itself', async () => {
    const { mapSignupError } = await loadModule()

    expect(mapSignupError(400, 'user_exists', 'BadRequestError')).toBe('created')
    expect(mapSignupError(400, 'invalid_signup', 'BadRequestError')).toBe('created')
    // Distinct outcomes exist, so the mapper is not a constant function.
    expect(mapSignupError(400, 'invalid_password', 'PasswordStrengthError')).toBe('weak_password')
    expect(mapSignupError(500, 'server_error', 'InternalError')).toBe('unavailable')
  })
})

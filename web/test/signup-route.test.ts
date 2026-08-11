/**
 * The signup route handler: what it puts in the HTTP response.
 *
 * The response is the enumeration surface an anonymous caller actually sees, so
 * the tests here assert over status AND body together -- a distinct status code
 * is just as good an oracle as a distinct message.
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
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function request(body: unknown) {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function loadRoute() {
  vi.resetModules()
  for (const [key, value] of Object.entries(AUTH0_ENV)) process.env[key] = value
  return await import('@/app/api/auth/signup/route')
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

describe('validation before any network call', () => {
  it('rejects a malformed email with 400 and calls nothing out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await loadRoute()

    const response = await POST(request({ email: 'not-an-email', password: PASSWORD }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('invalid_email')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a short password with 400 and calls nothing out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await loadRoute()

    const response = await POST(request({ email: 'user@example.com', password: 'short' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('password_too_short')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('handles a body that is not JSON at all', async () => {
    const { POST } = await loadRoute()
    const response = await POST(
      new Request('http://localhost/api/auth/signup', { method: 'POST', body: 'not json' }),
    )

    expect(response.status).toBe(400)
  })
})

describe('the response never echoes Auth0', () => {
  it('returns our own message, not the Auth0 policy body', async () => {
    const auth0Body = {
      name: 'PasswordStrengthError',
      code: 'invalid_password',
      description: { rules: [{ message: 'At least %d characters in length', format: [8] }] },
      policy: '* At least 8 characters in length',
      statusCode: 400,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(auth0Body, 400))
    const { POST } = await loadRoute()

    const response = await POST(request({ email: 'user@example.com', password: PASSWORD }))
    const text = JSON.stringify(await response.json())

    expect(text).not.toContain('PasswordStrengthError')
    expect(text).not.toContain('At least 8 characters in length')
    expect(text).not.toContain('statusCode')
    expect(text).not.toContain(PASSWORD)
    // Positive control: a real, useful message was still returned.
    expect(text).toContain('stronger password')
  })

  it('never echoes the submitted password on any path', async () => {
    const { POST } = await loadRoute()

    for (const [body, status] of [
      [{ email: 'bad', password: PASSWORD }, 400],
      [{ email: 'user@example.com', password: 'short' }, 400],
    ] as const) {
      const response = await POST(request(body))
      expect(response.status).toBe(status)
      expect(JSON.stringify(await response.json())).not.toContain(PASSWORD)
    }
  })
})

describe('a duplicate address is not distinguishable from a new one', () => {
  /**
   * Status AND body compared together. Reporting `user_exists` honestly here --
   * whether in the code, the message, or the status -- would let anyone submit
   * a list of addresses and learn which are registered.
   */
  it('answers user_exists exactly as it answers a fresh signup', async () => {
    const { POST } = await loadRoute()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ _id: 'new' }, 200))
    const fresh = await POST(request({ email: 'nobody@example.com', password: PASSWORD }))
    const freshBody = await fresh.json()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { name: 'BadRequestError', code: 'user_exists', description: 'The user already exists.' },
        400,
      ),
    )
    const duplicate = await POST(request({ email: 'known@example.com', password: PASSWORD }))
    const duplicateBody = await duplicate.json()

    expect(duplicate.status).toBe(fresh.status)
    expect(duplicateBody).toEqual(freshBody)
    expect(JSON.stringify(duplicateBody).toLowerCase()).not.toContain('exist')
    // Non-vacuous: both really are the success answer, not two identical errors.
    expect(fresh.status).toBe(200)
    expect(freshBody.code).toBe('created')
  })
})

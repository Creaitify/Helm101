/**
 * Where the credentials-flow access token goes, and where it must not.
 *
 * Modelled on test/auth-token-propagation.test.ts, which covers the OAuth path.
 * The credentials path needs its own file because next-auth shapes `account`
 * completely differently for it: for a Credentials provider next-auth builds
 * `account` itself as `{ providerAccountId, type: 'credentials', provider }`
 * (v4 core/routes/callback.js) with NO `access_token` field. An implementation
 * that reads `account.access_token` here stores `undefined`, the sign-in still
 * appears to succeed, and every FastAPI call 401s. That is the failure these
 * tests exist to catch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Account, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

const AUTH0_ENV = {
  AUTH0_ISSUER: 'https://helm.eu.auth0.com',
  AUTH0_CLIENT_ID: 'client-id-value',
  AUTH0_CLIENT_SECRET: 'client-secret-value',
  AUTH0_AUDIENCE: 'helm-api',
}
for (const [key, value] of Object.entries(AUTH0_ENV)) process.env[key] = value

const { helmApiGet, getToken, cookies, headers } = vi.hoisted(() => ({
  helmApiGet: vi.fn(),
  getToken: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('@/lib/server/helm-api-client', () => ({ helmApiGet }))
vi.mock('next-auth/jwt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-auth/jwt')>()),
  getToken,
}))
vi.mock('next/headers', () => ({ cookies, headers }))

const { authOptions } = await import('@/auth')
const jwtCallback = authOptions.callbacks!.jwt!
const sessionCallback = authOptions.callbacks!.session!

/** Non-substitutable literals, so reading the wrong field cannot pass. */
const ACCESS_TOKEN = 'credentials-access-token-alpha'
const SUBJECT = 'auth0|credentials-user'
const PASSWORD = 'correct-horse-battery-staple-9271'

/**
 * Exactly the `account` next-auth synthesises for a credentials sign-in.
 * Reproduced from v4 `core/routes/callback.js` -- note the absence of
 * `access_token`, which is the whole point.
 */
function credentialsAccount(): Account {
  return {
    providerAccountId: SUBJECT,
    type: 'credentials',
    provider: 'credentials',
  } as unknown as Account
}

/** Exactly what our `authorize` returns: the token's only channel. */
function credentialsUser(overrides: Record<string, unknown> = {}): User {
  return {
    id: SUBJECT,
    email: 'user@example.com',
    identitySubject: SUBJECT,
    accessToken: ACCESS_TOKEN,
    accessTokenExpires: 1_900_000_000,
    ...overrides,
  } as unknown as User
}

async function signInWithCredentials(user: User = credentialsUser()): Promise<JWT> {
  return (await jwtCallback({
    token: { sub: SUBJECT },
    account: credentialsAccount(),
    user,
  } as never)) as JWT
}

async function toSession(token: JWT): Promise<Session> {
  return (await sessionCallback({
    session: { user: {} } as Session,
    token,
  } as never)) as Session
}

describe('the credentials account shape', () => {
  it('carries no access_token, which is why the user object is the channel', async () => {
    // Pins the premise the implementation depends on. If a future next-auth
    // started populating `account.access_token` for credentials, this test
    // documents that the assumption changed.
    const account = credentialsAccount() as unknown as Record<string, unknown>

    expect(account.access_token).toBeUndefined()
    expect(account.type).toBe('credentials')
  })
})

describe('credentials access token propagation', () => {
  it('stores the access token returned by authorize', async () => {
    const token = await signInWithCredentials()

    // The assertion that fails if the implementation reads
    // `account.access_token` instead of `user.accessToken`.
    expect(token.accessToken).toBe(ACCESS_TOKEN)
  })

  it('records the immutable subject as the identity key, not the email', async () => {
    const token = await signInWithCredentials()

    expect(token.identitySubject).toBe(SUBJECT)
    expect(token.identitySubject).not.toBe('user@example.com')
  })

  it('carries the expiry forward', async () => {
    const token = await signInWithCredentials()

    expect(token.accessTokenExpires).toBe(1_900_000_000)
  })

  it('keeps the token across later calls that carry no account', async () => {
    const first = await signInWithCredentials()
    const second = (await jwtCallback({ token: first, account: null } as never)) as JWT

    expect(second.accessToken).toBe(ACCESS_TOKEN)
    expect(second.identitySubject).toBe(SUBJECT)
  })

  it('does not fabricate a token when authorize returned none', async () => {
    const token = await signInWithCredentials(credentialsUser({ accessToken: undefined }))

    expect(token.accessToken).toBeUndefined()
  })

  it('leaves the OAuth path reading account.access_token', async () => {
    // The credentials branch must not have broken the provider it sits beside.
    const oauthToken = (await jwtCallback({
      token: {},
      account: {
        provider: 'auth0',
        type: 'oauth',
        providerAccountId: 'auth0|oauth-user',
        access_token: 'oauth-access-token-beta',
        expires_at: 1_800_000_000,
      } as unknown as Account,
      user: { id: 'auth0|oauth-user' } as User,
    } as never)) as JWT

    expect(oauthToken.accessToken).toBe('oauth-access-token-beta')
    expect(oauthToken.identitySubject).toBe('auth0|oauth-user')
  })
})

describe('the credentials token never reaches the browser', () => {
  /**
   * The load-bearing assertion, mirroring the OAuth file: not "has no
   * `accessToken` property" but absent under ANY key at ANY depth, over the
   * whole serialized session -- which is literally the JSON body of
   * `GET /api/auth/session`, readable by any script on a signed-in page.
   */
  it('never places the access token on the session, by any key at any depth', async () => {
    const token = await signInWithCredentials()
    const session = await toSession(token)

    // Positive control: the token really is on the JWT, so the assertion below
    // is examining a session derived from a token that HAS something to leak.
    expect(token.accessToken).toBe(ACCESS_TOKEN)
    expect(JSON.stringify(session)).not.toContain(ACCESS_TOKEN)
  })

  it('exposes the subject and no credential', async () => {
    const token = await signInWithCredentials()
    const session = await toSession(token)

    expect(session.user?.identitySubject).toBe(SUBJECT)
    expect((session as unknown as Record<string, unknown>).accessToken).toBeUndefined()
  })

  it('never places the password on the session or the jwt', async () => {
    // The password is not supposed to be anywhere near either structure. This
    // asserts it, including via the user object, which DOES cross into the jwt
    // callback and could carry a stray field.
    const token = await signInWithCredentials(
      credentialsUser({ password: PASSWORD } as Record<string, unknown>),
    )
    const session = await toSession(token)

    expect(JSON.stringify(token)).not.toContain(PASSWORD)
    expect(JSON.stringify(session)).not.toContain(PASSWORD)
  })
})

describe('the credentials token reaching FastAPI', () => {
  beforeEach(() => {
    helmApiGet.mockReset()
    getToken.mockReset()
    cookies.mockReset().mockResolvedValue({ getAll: () => [] })
    headers.mockReset().mockResolvedValue(new Headers())
  })

  it('sends the credentials-flow access token to the API', async () => {
    const token = await signInWithCredentials()

    getToken.mockResolvedValue(token)
    helmApiGet.mockResolvedValue({ data: [] })

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await listTenantsFromApi()

    expect(helmApiGet).toHaveBeenCalledTimes(1)
    const [request] = helmApiGet.mock.calls[0] as [{ accessToken: string }]
    expect(request.accessToken).toBe(ACCESS_TOKEN)
  })

  it('refuses the API call when the credentials sign-in produced no token', async () => {
    const token = await signInWithCredentials(credentialsUser({ accessToken: undefined }))

    getToken.mockResolvedValue(token)

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await expect(listTenantsFromApi()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })
})

describe('authorize refuses bad credentials', () => {
  /**
   * Read `authorize` from `provider.options`, NOT from `provider.authorize`.
   *
   * next-auth v4's `Credentials()` factory returns a fixed object whose own
   * `authorize` is the placeholder `() => null`, and stashes the caller's
   * config under `options` for its initialisation step to merge in later
   * (`node_modules/next-auth/providers/credentials.js`). Calling
   * `provider.authorize` therefore always yields `null` without running any of
   * our code -- which is exactly how the first draft of these tests "passed"
   * the two rejection cases while proving nothing about them.
   */
  function credentialsAuthorize() {
    const provider = authOptions.providers.find(
      (p) => (p as { id?: string }).id === 'credentials',
    ) as unknown as {
      options?: { authorize?: (c: Record<string, string>) => Promise<User | null> }
    }
    return provider?.options?.authorize
  }

  it('is registered with our own authorize, not the library placeholder', () => {
    const authorize = credentialsAuthorize()

    // Guards the whole describe block below: without this, every rejection test
    // here would pass against next-auth's `() => null` stub.
    expect(authorize).toBeTypeOf('function')
  })

  it('returns null -- not a user -- when Auth0 rejects the password', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_grant', error_description: 'Wrong email or password.' }),
    } as Response)

    const user = await credentialsAuthorize()!({
      email: 'user@example.com',
      password: PASSWORD,
    })

    // next-auth signs the user in if and only if this is truthy. Returning any
    // object here -- even one without a token -- would establish a session.
    expect(user).toBeNull()
    vi.restoreAllMocks()
  })

  it('returns null for an unknown account, identically', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'user does not exist in connection Username-Password-Authentication',
      }),
    } as Response)

    const user = await credentialsAuthorize()!({
      email: 'nobody@example.com',
      password: PASSWORD,
    })

    expect(user).toBeNull()
    vi.restoreAllMocks()
  })

  it('returns a user carrying the access token on success', async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const idToken = `${b64({ alg: 'RS256' })}.${b64({ sub: SUBJECT })}.sig`

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: ACCESS_TOKEN, id_token: idToken, expires_in: 3600 }),
    } as Response)

    const user = await credentialsAuthorize()!({
      email: 'user@example.com',
      password: PASSWORD,
    })

    expect(user).not.toBeNull()
    expect(user!.id).toBe(SUBJECT)
    expect((user as unknown as { accessToken?: string }).accessToken).toBe(ACCESS_TOKEN)
    // The password does not survive into the returned user.
    expect(JSON.stringify(user)).not.toContain(PASSWORD)
    vi.restoreAllMocks()
  })
})

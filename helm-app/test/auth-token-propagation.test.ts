import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Account, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { authOptions } from '@/auth'

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

const jwtCallback = authOptions.callbacks!.jwt!
const sessionCallback = authOptions.callbacks!.session!

/**
 * The two credentials Auth0 returns are deliberately non-substitutable
 * literals. An implementation that reads `id_token` where it should read
 * `access_token` must fail loudly rather than pass on a shared value.
 */
const ACCESS_TOKEN = 'access-token-alpha'
const ID_TOKEN = 'id-token-beta'

function makeAccount(overrides: Record<string, unknown> = {}): Account {
  return {
    provider: 'auth0',
    type: 'oauth',
    providerAccountId: 'auth0|abc123',
    access_token: ACCESS_TOKEN,
    id_token: ID_TOKEN,
    expires_at: 1_900_000_000,
    ...overrides,
  } as unknown as Account
}

async function signIn(account: Account = makeAccount(), token: JWT = {} as JWT): Promise<JWT> {
  return (await jwtCallback({
    token,
    account,
    user: { id: 'auth0|abc123' },
  } as never)) as JWT
}

async function toSession(token: JWT): Promise<Session> {
  return (await sessionCallback({
    session: { user: {} } as Session,
    token,
  } as never)) as Session
}

describe('access token propagation', () => {
  it('stores the ACCESS token, never the id token', async () => {
    const token = await signIn()

    expect(token.accessToken).toBe(ACCESS_TOKEN)
    expect(token.accessToken).not.toBe(ID_TOKEN)
    expect(JSON.stringify(token)).not.toContain(ID_TOKEN)
  })

  it('records the immutable subject as the identity key', async () => {
    const token = await signIn()

    expect(token.identitySubject).toBe('auth0|abc123')
  })

  it('carries the access token expiry forward as accessTokenExpires', async () => {
    const token = await signIn()

    expect(token.accessTokenExpires).toBe(1_900_000_000)
  })

  it('keeps the stored token across calls that carry no account', async () => {
    const first = await signIn()
    const second = (await jwtCallback({ token: first, account: null } as never)) as JWT

    expect(second.accessToken).toBe(ACCESS_TOKEN)
    expect(second.identitySubject).toBe('auth0|abc123')
    expect(second.accessTokenExpires).toBe(1_900_000_000)
  })

  it('does not fabricate an access token when the provider returned none', async () => {
    const token = await signIn(makeAccount({ access_token: undefined }))

    expect(token.accessToken).toBeUndefined()
    // Falling back to the id token here is the exact defect this task exists to
    // prevent: it would verify against the JWKS and then fail on `aud`.
    expect(JSON.stringify(token)).not.toContain(ID_TOKEN)
  })

  it('exposes the subject on the session, and no credential', async () => {
    const session = await toSession({
      sub: 'auth0|abc123',
      accessToken: ACCESS_TOKEN,
      identitySubject: 'auth0|abc123',
    } as JWT)

    expect(session.user?.id).toBe('auth0|abc123')
    expect(session.user?.identitySubject).toBe('auth0|abc123')
    // Inverted from an earlier assertion that the session DID carry the access
    // token. Whatever this callback returns is the JSON body of
    // `GET /api/auth/session` (next-auth v4 core/routes/session.js sets
    // `response.body = updatedSession`), which any script on a signed-in page
    // can fetch. A token there is a readable bearer credential for helm-api.
    expect((session as unknown as Record<string, unknown>).accessToken).toBeUndefined()
  })

  /**
   * The load-bearing assertion of this file. Not "has no `accessToken`
   * property" -- the token must be absent under ANY key at ANY depth, so this
   * serializes the entire returned session and looks for the value itself.
   * `ACCESS_TOKEN` is a distinctive literal precisely so a leak via a renamed
   * key, a nested object, or a spread is still caught.
   */
  it('never places the access token on the session, by any key at any depth', async () => {
    const token = await signIn()
    const session = await toSession(token)

    expect(JSON.stringify(session)).not.toContain(ACCESS_TOKEN)
  })

  it('never places the id token on the session, by any route', async () => {
    const token = await signIn()
    const session = await toSession(token)

    expect(JSON.stringify(session)).not.toContain(ID_TOKEN)
  })

  it('leaks no credential even when the jwt carries every one of them', async () => {
    const session = await toSession({
      sub: 'auth0|abc123',
      accessToken: ACCESS_TOKEN,
      accessTokenExpires: 1_900_000_000,
      identitySubject: 'auth0|abc123',
    } as JWT)

    const serialized = JSON.stringify(session)
    expect(serialized).not.toContain(ACCESS_TOKEN)
    expect(serialized).not.toContain(ID_TOKEN)
  })
})

describe('the token that actually reaches FastAPI', () => {
  beforeEach(() => {
    helmApiGet.mockReset()
    getToken.mockReset()
    cookies.mockReset().mockResolvedValue({ getAll: () => [] })
    headers.mockReset().mockResolvedValue(new Headers())
  })

  /**
   * End-to-end over the real jwt callback: a real Auth0 `account` produces the
   * JWT that lives in the encrypted cookie, and THAT -- not the session object
   * served to the browser -- is what the API client reads. This is the
   * assertion that proves the ID token cannot reach FastAPI, and it now also
   * pins the server-side read path.
   */
  it('sends the access token from a real sign-in, and not the id token', async () => {
    const token = await signIn()

    getToken.mockResolvedValue(token)
    helmApiGet.mockResolvedValue({ data: [] })

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await listTenantsFromApi()

    expect(helmApiGet).toHaveBeenCalledTimes(1)
    const [request] = helmApiGet.mock.calls[0] as [{ accessToken: string }]
    expect(request.accessToken).toBe(ACCESS_TOKEN)
    expect(request.accessToken).not.toBe(ID_TOKEN)
    expect(JSON.stringify(helmApiGet.mock.calls[0])).not.toContain(ID_TOKEN)
  })

  /**
   * The session object of that very same sign-in must be free of the token the
   * previous test just proved reaches FastAPI. Together the two say: the
   * credential travels server-side only.
   */
  it('does not put the token it sends to FastAPI onto the browser-visible session', async () => {
    const token = await signIn()
    const session = await toSession(token)

    getToken.mockResolvedValue(token)
    helmApiGet.mockResolvedValue({ data: [] })

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await listTenantsFromApi()

    const [request] = helmApiGet.mock.calls[0] as [{ accessToken: string }]
    expect(request.accessToken).toBe(ACCESS_TOKEN)
    expect(JSON.stringify(session)).not.toContain(request.accessToken)
  })

  it('refuses the API call when sign-in produced no access token', async () => {
    const token = await signIn(makeAccount({ access_token: undefined }))

    getToken.mockResolvedValue(token)

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await expect(listTenantsFromApi()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Account, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { authOptions } from '@/auth'

const { helmApiGet, getServerSession } = vi.hoisted(() => ({
  helmApiGet: vi.fn(),
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/server/helm-api-client', () => ({ helmApiGet }))
vi.mock('next-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-auth')>()),
  getServerSession,
}))

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

  it('exposes the access token and subject on the session', async () => {
    const session = await toSession({
      sub: 'auth0|abc123',
      accessToken: ACCESS_TOKEN,
      identitySubject: 'auth0|abc123',
    } as JWT)

    expect(session.accessToken).toBe(ACCESS_TOKEN)
    expect(session.user?.id).toBe('auth0|abc123')
    expect(session.user?.identitySubject).toBe('auth0|abc123')
  })

  it('omits the access token when the jwt never carried one', async () => {
    const session = await toSession({ sub: 'auth0|abc123' } as JWT)

    expect(session.accessToken).toBeUndefined()
  })

  it('never places the id token on the session, by any route', async () => {
    const token = await signIn()
    const session = await toSession(token)

    expect(JSON.stringify(session)).not.toContain(ID_TOKEN)
  })
})

describe('the token that actually reaches FastAPI', () => {
  beforeEach(() => {
    helmApiGet.mockReset()
    getServerSession.mockReset()
  })

  /**
   * End-to-end over the callbacks: a real Auth0 `account` goes through the jwt
   * and session callbacks, and the resulting session is what the API client
   * sees. This is the assertion that proves the ID token cannot reach FastAPI.
   */
  it('sends the access token from a real sign-in, and not the id token', async () => {
    const token = await signIn()
    const session = await toSession(token)

    getServerSession.mockResolvedValue(session)
    helmApiGet.mockResolvedValue({ data: [] })

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await listTenantsFromApi()

    expect(helmApiGet).toHaveBeenCalledTimes(1)
    const [request] = helmApiGet.mock.calls[0] as [{ accessToken: string }]
    expect(request.accessToken).toBe(ACCESS_TOKEN)
    expect(request.accessToken).not.toBe(ID_TOKEN)
    expect(JSON.stringify(helmApiGet.mock.calls[0])).not.toContain(ID_TOKEN)
  })

  it('refuses the API call when sign-in produced no access token', async () => {
    const token = await signIn(makeAccount({ access_token: undefined }))
    const session = await toSession(token)

    getServerSession.mockResolvedValue(session)

    const { listTenantsFromApi } = await import('@/lib/server/tenant-directory')
    await expect(listTenantsFromApi()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })
})

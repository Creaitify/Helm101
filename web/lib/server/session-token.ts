import 'server-only'
import { cookies, headers } from 'next/headers'
import { getToken } from 'next-auth/jwt'
import { env } from './env'

/** The caller has no decodable session token. Callers redirect to /login. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('The caller is not authenticated')
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Read the Auth0 access token for the current request, or throw.
 *
 * The credential is read straight out of the encrypted session cookie rather
 * than from `getServerSession()`. The session object is what next-auth serves
 * as the body of `GET /api/auth/session`, so the access token deliberately is
 * not on it (see the session callback in auth.ts). `getToken` decrypts the
 * JWT in-process; the token never crosses a response boundary.
 *
 * In Next 16 `cookies()` and `headers()` are async: `cookies()` returns a
 * store exposing `getAll()` and `headers()` returns a Web `Headers` -- both
 * shapes `getToken`'s SessionStore already handles.
 */
export async function requireAccessToken(): Promise<string> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const token = await getToken({
    req: { cookies: cookieStore, headers: headerList } as never,
    secret: env.authSecret,
  })
  const accessToken = token?.accessToken
  if (!accessToken) throw new UnauthenticatedError()
  return accessToken
}

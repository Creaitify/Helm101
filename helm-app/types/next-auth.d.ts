import 'next-auth'

declare module 'next-auth' {
  interface User {
    id: string
    /** Immutable Auth0 `sub`. The identity key; email never is. */
    identitySubject?: string
  }

  /**
   * The session is served verbatim as the body of `GET /api/auth/session`, so
   * it must never declare a credential field. The Auth0 access token -- the
   * only credential FastAPI accepts -- lives on the `JWT` below, inside the
   * encrypted cookie, and is read server-side via `getToken()`.
   */
  interface Session {
    user: User
    error?: 'token_expired'
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    accessTokenExpires?: number
    identitySubject?: string
    error?: 'token_expired'
  }
}

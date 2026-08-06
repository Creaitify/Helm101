import 'next-auth'

declare module 'next-auth' {
  interface User {
    id: string
    /** Immutable Auth0 `sub`. The identity key; email never is. */
    identitySubject?: string
  }

  /** The Auth0 access token is the only credential FastAPI accepts. */
  interface Session {
    user: User
    accessToken?: string
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

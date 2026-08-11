import 'next-auth'

declare module 'next-auth' {
  interface User {
    id: string
    /** Immutable Auth0 `sub`. The identity key; email never is. */
    identitySubject?: string
    /**
     * Credentials path only, and NOT part of the session.
     *
     * The `User` returned by `authorize` is the sole channel carrying the access
     * token to the `jwt` callback -- next-auth's synthesised credentials
     * `account` has no `access_token` field. This object is never served to the
     * browser: the `session` callback copies only `id` and `identitySubject`
     * across, and `Session.user` is a separate declaration below that does not
     * inherit these fields as populated values.
     */
    accessToken?: string
    accessTokenExpires?: number
  }

  /**
   * The session is served verbatim as the body of `GET /api/auth/session`, so
   * it must never declare a credential field. The Auth0 access token -- the
   * only credential FastAPI accepts -- lives on the `JWT` below, inside the
   * encrypted cookie, and is read server-side via `getToken()`.
   */
  interface Session {
    // Deliberately NOT `User`. `User` gained `accessToken` for the credentials
    // path, and reusing it here would make the session type declare a
    // credential field -- which is how the previous leak got past TypeScript:
    // the type agreed with the vulnerability. This picks only the fields the
    // session callback actually copies, so the type system now refuses a
    // credential on the session instead of blessing one.
    user: Pick<User, 'id' | 'identitySubject' | 'name' | 'email' | 'image'>
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

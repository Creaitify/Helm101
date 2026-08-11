import 'server-only'
import { env } from '@/lib/server/env'

/**
 * Direct email/password exchange against Auth0, for the embedded login form.
 *
 * Everything in this file handles a password or a token. Two rules hold
 * throughout and are the reason for most of the shape below:
 *
 *  1. A password is never logged, never returned, never placed in an error, and
 *     never stored. It exists only as a field of the request body that trades it
 *     for a token, and goes out of scope when that request returns.
 *  2. Auth0's error bodies are never surfaced. They distinguish "no such user"
 *     from "wrong password" and carry policy detail; both are answered here with
 *     a single opaque failure.
 */

/** The Auth0 database connection users are created in and authenticated against. */
export const REALM = 'Username-Password-Authentication'

/**
 * The realm-scoped password grant, not the plain `password` grant.
 *
 * Plain `password` lets Auth0 pick the connection, so an account in an
 * unintended connection (a staging directory, an enterprise connection sharing
 * the tenant) could satisfy a login meant for the database realm. Naming the
 * realm pins authentication to exactly one connection.
 */
export const PASSWORD_REALM_GRANT = 'http://auth0.com/oauth/grant-type/password-realm'

export const MIN_PASSWORD_LENGTH = 8

/** The single failure answer. Never says which of the two things went wrong. */
export type CredentialFailure = { ok: false }

export type CredentialSuccess = {
  ok: true
  /** Immutable Auth0 `sub`. The identity key -- email never is. */
  subject: string
  /** The only credential FastAPI accepts: it alone carries `aud: helm-api`. */
  accessToken: string
  expiresAt?: number
  email?: string
}

export type Auth0Config = {
  issuer: string
  clientId: string
  clientSecret: string
  audience: string
}

/**
 * The four values the password grant needs, or `null` if any is missing.
 *
 * Deliberately the same four-value guard the Auth0 OAuth provider registers
 * under. `audience` is part of the guard rather than just a parameter: without
 * it Auth0 returns an opaque access token with no `aud` claim, unverifiable
 * against the JWKS, so every FastAPI call 401s -- a failure that surfaces at
 * first login and reads as broken auth rather than missing configuration.
 */
export function auth0Config(): Auth0Config | null {
  const { auth0Issuer, auth0ClientId, auth0ClientSecret, auth0Audience } = env
  if (!auth0Issuer || !auth0ClientId || !auth0ClientSecret || !auth0Audience) return null
  return {
    issuer: auth0Issuer,
    clientId: auth0ClientId,
    clientSecret: auth0ClientSecret,
    audience: auth0Audience,
  }
}

/** Join an issuer and a path without producing a double slash. */
export function auth0Url(issuer: string, path: string): string {
  return `${issuer.replace(/\/+$/, '')}${path}`
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const email = value.trim()
  // Deliberately conservative rather than RFC-complete: one @, no whitespace,
  // a dot-bearing domain. Auth0 is the authority on deliverability; this only
  // avoids a pointless network round trip for obvious nonsense.
  if (email.length === 0 || email.length > 320) return false
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH
}

/**
 * Read the `sub` claim from an ID token WITHOUT verifying its signature.
 *
 * This is a deliberate, justified choice rather than an oversight. The usual
 * reason to verify an ID token is that it arrived from an untrusted party --
 * typically via the user's browser, which could substitute one. That does not
 * apply here: this token is the body of a TLS response from Auth0's own token
 * endpoint, returned to a request this server authenticated with its
 * `client_secret`. There is no intermediary between the signer and this line
 * whose substitution a signature check would catch; the TLS channel and the
 * authenticated client already establish origin.
 *
 * The claim is therefore parsed, not trusted-by-signature. If this token ever
 * starts arriving by any other route -- a redirect, a client POST, a cache --
 * this reasoning lapses and the signature must be verified against the JWKS.
 */
export function subjectFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null
  const segments = idToken.split('.')
  if (segments.length !== 3) return null
  try {
    // base64url -> base64 before decoding; ID tokens use the URL-safe alphabet.
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(payload, 'base64').toString('utf8')
    const claims = JSON.parse(json) as { sub?: unknown }
    return typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null
  } catch {
    // A malformed token is a failed login, not an exception to propagate: the
    // message could carry a fragment of the token itself.
    return null
  }
}

type TokenResponse = {
  access_token?: unknown
  id_token?: unknown
  expires_in?: unknown
}

/**
 * Exchange an email and password for Auth0 tokens.
 *
 * Returns `{ ok: false }` for every failure mode without distinction. A caller
 * cannot tell a nonexistent account from a wrong password from an Auth0 outage,
 * and that is the point: any difference between the first two is a user
 * enumeration oracle.
 */
export async function exchangePasswordForTokens(
  email: string,
  password: string,
): Promise<CredentialSuccess | CredentialFailure> {
  const config = auth0Config()
  if (!config) return { ok: false }
  if (!isValidEmail(email) || !isValidPassword(password)) return { ok: false }

  let response: Response
  try {
    response = await fetch(auth0Url(config.issuer, '/oauth/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: PASSWORD_REALM_GRANT,
        realm: REALM,
        username: email,
        password,
        audience: config.audience,
        scope: 'openid profile email',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    })
  } catch {
    // Swallowed deliberately: a fetch rejection message can include the request
    // URL and, depending on the runtime, request detail. Nothing derived from
    // this error reaches a log or a response.
    return { ok: false }
  }

  // The error body is never read, never logged, never returned. Auth0 answers a
  // wrong password with `invalid_grant` and an unknown user with `invalid_grant`
  // too, but the descriptions differ -- so the body itself is the enumeration
  // oracle, and the only safe handling is to discard it.
  if (!response.ok) return { ok: false }

  let body: TokenResponse
  try {
    body = (await response.json()) as TokenResponse
  } catch {
    return { ok: false }
  }

  const accessToken = body.access_token
  // Never fall back to `id_token`. It verifies against the same JWKS but
  // carries the wrong `aud`, so FastAPI rejects it in a way that looks like
  // broken auth rather than a wrong token.
  if (typeof accessToken !== 'string' || accessToken.length === 0) return { ok: false }

  const subject = subjectFromIdToken(body.id_token)
  // No subject means no identity key. Email is never the identity key, so there
  // is nothing to fall back to and the login fails.
  if (!subject) return { ok: false }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : undefined

  return {
    ok: true,
    subject,
    accessToken,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
    email,
  }
}

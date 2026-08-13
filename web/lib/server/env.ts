import 'server-only'

function optional(name: string) {
  return process.env[name]?.trim() || undefined
}

/** Server-only service configuration. No value here is safe to expose as NEXT_PUBLIC_. */
export const env = {
  authSecret: optional('AUTH_SECRET'),
  googleClientId: optional('AUTH_GOOGLE_ID'),
  googleClientSecret: optional('AUTH_GOOGLE_SECRET'),
  microsoftClientId: optional('AUTH_MICROSOFT_ENTRA_ID_ID'),
  microsoftClientSecret: optional('AUTH_MICROSOFT_ENTRA_ID_SECRET'),
  microsoftIssuer: optional('AUTH_MICROSOFT_ENTRA_ID_ISSUER'),
  auth0Issuer: optional('AUTH0_ISSUER'),
  auth0ClientId: optional('AUTH0_CLIENT_ID'),
  auth0ClientSecret: optional('AUTH0_CLIENT_SECRET'),
  auth0Audience: optional('AUTH0_AUDIENCE'),
  helmApiBaseUrl: optional('HELM_API_BASE_URL'),
  encryptionKey: optional('ENCRYPTION_KEY'),
  appEnv: optional('HELM_ENV') ?? 'development',
} as const

// isDemoMode lives in lib/demo-mode.ts (proxy.ts needs it and cannot import
// through `server-only`); re-exported here so server code keeps one import
// path for its environment questions.
export { isDemoMode } from '../demo-mode'

/**
 * The web-side counterpart of the API's ALLOW_LOCAL_PRINCIPAL: lets the
 * Workspace ask the real Analyst without an Auth0 session, so the live agent
 * is demonstrable in a browser before the Auth0 dashboard step is done. The
 * API ignores the bearer value entirely in local-principal mode, so no
 * credential is fabricated here — the placeholder only satisfies the client's
 * request shape.
 *
 * Mirrors the API's guard rather than its own invention: refused loudly in
 * staging and production (the API refuses ALLOW_LOCAL_PRINCIPAL at startup
 * the same way), and inert without a configured API to talk to.
 */
export function allowLocalAnalyst(): boolean {
  if (optional('ALLOW_LOCAL_ANALYST') !== 'true') return false
  if (!optional('HELM_API_BASE_URL')) return false
  const appEnv = optional('HELM_ENV') ?? 'development'
  if (appEnv === 'staging' || appEnv === 'production') {
    throw new Error('ALLOW_LOCAL_ANALYST must never be enabled in staging or production')
  }
  return true
}

export function requireServerEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key]
  if (!value) throw new Error(`Missing required server environment variable: ${key}`)
  return value
}

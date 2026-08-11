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

/**
 * Demo mode serves every surface from fixtures and skips the helm-api tenant
 * lookup. An explicit HELM_DEMO_MODE=true/false always wins; when unset, demo
 * is the default exactly when no HELM_API_BASE_URL is configured, so a fresh
 * checkout with an empty .env.local still renders the full UI with zero
 * setup. Computed per call (not baked into the frozen object above) so tests
 * can vary the environment.
 */
export function isDemoMode(): boolean {
  const explicit = optional('HELM_DEMO_MODE')
  if (explicit !== undefined) return explicit === 'true'
  return !optional('HELM_API_BASE_URL')
}

export function requireServerEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key]
  if (!value) throw new Error(`Missing required server environment variable: ${key}`)
  return value
}

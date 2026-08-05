import 'server-only'

function optional(name: string) {
  return process.env[name]?.trim() || undefined
}

/** Server-only service configuration. No value here is safe to expose as NEXT_PUBLIC_. */
export const env = {
  databaseUrl: optional('NEON_DATABASE_URL'),
  databaseUrlUnpooled: optional('NEON_DATABASE_URL_UNPOOLED'),
  platformReaderUrl: optional('NEON_PLATFORM_READER_URL'),
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

export function requireServerEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key]
  if (!value) throw new Error(`Missing required server environment variable: ${key}`)
  return value
}

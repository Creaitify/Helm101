import 'server-only'

function optional(name: string) {
  return process.env[name]?.trim() || undefined
}

/** Server-only service configuration. No value here is safe to expose as NEXT_PUBLIC_. */
export const env = {
  databaseUrl: optional('NEON_DATABASE_URL'),
  databaseUrlUnpooled: optional('NEON_DATABASE_URL_UNPOOLED'),
  authSecret: optional('AUTH_SECRET'),
  googleClientId: optional('AUTH_GOOGLE_ID'),
  googleClientSecret: optional('AUTH_GOOGLE_SECRET'),
  microsoftClientId: optional('AUTH_MICROSOFT_ENTRA_ID_ID'),
  microsoftClientSecret: optional('AUTH_MICROSOFT_ENTRA_ID_SECRET'),
  microsoftIssuer: optional('AUTH_MICROSOFT_ENTRA_ID_ISSUER'),
  encryptionKey: optional('ENCRYPTION_KEY'),
  appEnv: optional('HELM_ENV') ?? 'development',
} as const

export function requireServerEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key]
  if (!value) throw new Error(`Missing required server environment variable: ${key}`)
  return value
}

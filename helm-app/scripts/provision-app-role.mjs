// One-time (or rotation-time) provisioning for the `helm_app` runtime role.
//
// `db/migrations/0005_app_role.sql` creates the `helm_app` role but never
// sets a password -- passwords must never live in a committed migration
// file. This script sets it out-of-band: it connects as the migration
// owner (NEON_DATABASE_URL_UNPOOLED), issues an `alter role ... password`
// using a value supplied only via environment variable, verifies the role
// still cannot bypass RLS, and prints a connection string (password
// masked) for you to paste into `.env.local` / Vercel env yourself.
//
// Usage:
//   HELM_APP_ROLE_PASSWORD='...' npm run db:provision-app-role
import nextEnv from '@next/env'
import { Pool } from '@neondatabase/serverless'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const connectionString = process.env.NEON_DATABASE_URL_UNPOOLED
if (!connectionString) {
  console.error('NEON_DATABASE_URL_UNPOOLED is required in .env.local (owner connection, used only to run the ALTER ROLE).')
  process.exit(1)
}

const password = process.env.HELM_APP_ROLE_PASSWORD
if (!password) {
  console.error(
    [
      'HELM_APP_ROLE_PASSWORD is not set.',
      '',
      'This script never generates or hardcodes a password. Generate a high-entropy',
      'value yourself and re-run with it set, for example:',
      '',
      '  HELM_APP_ROLE_PASSWORD="$(openssl rand -base64 32)" npm run db:provision-app-role',
      '',
      '(On Windows PowerShell:',
      '  $env:HELM_APP_ROLE_PASSWORD = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))',
      '  npm run db:provision-app-role )',
    ].join('\n'),
  )
  process.exit(1)
}

const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  const roleExists = await client.query("select 1 from pg_roles where rolname = 'helm_app'")
  if (!roleExists.rowCount) {
    console.error("Role 'helm_app' does not exist. Run `npm run db:migrate` first (applies 0005_app_role.sql).")
    process.exit(1)
  }

  // ALTER ROLE does not accept bind parameters. Round-trip the password
  // through quote_literal() server-side rather than interpolating it
  // ourselves, so Postgres -- not string concatenation -- decides the
  // escaping.
  const literal = await client.query('select quote_literal($1) as lit', [password])
  const quoted = literal.rows[0].lit
  await client.query(`alter role helm_app with password ${quoted}`)

  const check = await client.query(
    "select rolname, rolbypassrls, rolcanlogin from pg_roles where rolname = 'helm_app'",
  )
  const row = check.rows[0]
  if (!row) throw new Error('helm_app role vanished after ALTER ROLE (unexpected).')
  if (row.rolbypassrls !== false) {
    throw new Error(
      `SAFETY CHECK FAILED: helm_app.rolbypassrls = ${row.rolbypassrls}, expected false. ` +
        'Tenant isolation would be silently defeated. Do not use this role until fixed.',
    )
  }
  console.log('Verified: helm_app.rolbypassrls = false (RLS cannot be bypassed).')
  console.log(`Verified: helm_app.rolcanlogin = ${row.rolcanlogin}`)

  const url = new URL(connectionString)
  url.username = 'helm_app'
  url.password = '***MASKED***'
  // The unpooled owner URL has no host pooler suffix stripped; the app
  // should use the pooled endpoint. We only reconstruct the credentials
  // portion here -- copy the host from your normal pooled connection string.
  console.log('')
  console.log('helm_app password set successfully.')
  console.log('')
  console.log('Connection string (password masked, host/query params taken from NEON_DATABASE_URL_UNPOOLED):')
  console.log(`  ${url.toString()}`)
  console.log('')
  console.log('Next steps (this script will NOT do these for you):')
  console.log('  1. Build the real connection string using the helm_app username, the password')
  console.log('     you just set, and your normal POOLED Neon host (not the unpooled one above).')
  console.log('  2. Set it as NEON_DATABASE_URL in .env.local for local dev.')
  console.log('  3. Set the same value as NEON_DATABASE_URL in Vercel env for every deployed environment.')
  console.log('  4. Never commit the real password anywhere.')
} finally {
  client.release()
  await pool.end()
}

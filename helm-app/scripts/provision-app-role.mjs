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
  const quoted = literal.rows[0]?.lit
  if (!quoted) throw new Error('quote_literal($1) returned no row/value (unexpected) -- refusing to build an ALTER ROLE statement from an empty result.')
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

  // Deliberately do NOT assemble or print a connection string here. Doing so
  // previously built one from the UNPOOLED host (NEON_DATABASE_URL_UNPOOLED)
  // while telling the operator to use the POOLED host instead -- an easy
  // copy-paste trap where someone grabs the printed (masked) URL, swaps in
  // the real password, and points NEON_DATABASE_URL at the wrong (unpooled)
  // host. Print only the username and plain-language instructions instead.
  console.log('')
  console.log('helm_app password set successfully.')
  console.log('')
  console.log('Next steps (this script will NOT do these for you):')
  console.log('  1. Take your normal POOLED Neon connection string (NOT NEON_DATABASE_URL_UNPOOLED --')
  console.log('     that host must never be used by the running app) and swap in:')
  console.log('       username: helm_app')
  console.log('       password: the value you just set via HELM_APP_ROLE_PASSWORD')
  console.log('  2. Set the resulting string as NEON_DATABASE_URL in .env.local for local dev.')
  console.log('  3. Set the same value as NEON_DATABASE_URL in Vercel env for every deployed environment.')
  console.log('  4. Never commit the real password anywhere.')
} finally {
  client.release()
  await pool.end()
}

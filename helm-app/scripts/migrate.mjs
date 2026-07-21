import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import nextEnv from '@next/env'
import { Pool } from '@neondatabase/serverless'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const connectionString = process.env.NEON_DATABASE_URL_UNPOOLED
if (!connectionString) throw new Error('NEON_DATABASE_URL_UNPOOLED is required in .env.local')

const migrationDir = resolve(process.cwd(), 'db/migrations')
const migrationNames = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort()
const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const foundationsExist = await client.query("select to_regclass('public.tenants') is not null as exists")
  if (foundationsExist.rows[0]?.exists) await client.query("insert into schema_migrations (name) values ('0001_foundations.sql') on conflict do nothing")

  for (const name of migrationNames) {
    const existing = await client.query('select 1 from schema_migrations where name = $1', [name])
    if (existing.rowCount) continue
    const sql = await readFile(resolve(migrationDir, name), 'utf8')
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into schema_migrations (name) values ($1)', [name])
      await client.query('commit')
      console.log(`Applied ${name}`)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
} finally {
  client.release()
  await pool.end()
}

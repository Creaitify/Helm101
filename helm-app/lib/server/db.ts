import 'server-only'
import { Pool } from '@neondatabase/serverless'
import { env, requireServerEnv } from './env'
import { createTenantContext, establishTenantContext, type TenantContext, type TenantQueryTransaction } from './tenant-context'

function createPool() {
  return new Pool({ connectionString: requireServerEnv('databaseUrl') })
}

export async function checkDatabaseConnection() {
  if (!env.databaseUrl) return { configured: false, connected: false }
  const pool = createPool()
  try {
    await pool.query('select 1 as connected')
    return { configured: true, connected: true }
  } finally {
    await pool.end()
  }
}

export interface RoleBypassRow {
  role: string
  rolbypassrls: boolean
}

/**
 * Pure assertion over an already-queried pg_roles row. Kept separate from the
 * query itself so it is testable without a live database.
 *
 * Throws a clear, actionable error if the connecting role can bypass RLS —
 * that silently disables every tenant-isolation policy in the schema (this is
 * exactly how HELM's tenant-isolation-bypass defect went unnoticed: the app
 * was connecting as `neondb_owner`, which has `rolbypassrls = true`).
 */
export function assertRoleCannotBypassRls(row: RoleBypassRow): void {
  if (row.rolbypassrls) {
    throw new Error(
      `Refusing to serve tenant-scoped queries: the connecting database role "${row.role}" has ` +
        'rolbypassrls = true, which silently disables every RLS tenant-isolation policy. ' +
        'NEON_DATABASE_URL must authenticate as a non-bypassing runtime role (helm_app), never ' +
        'an owner/admin role. Run `npm run db:provision-app-role` to provision it, then point ' +
        'NEON_DATABASE_URL at that role.',
    )
  }
}

// Memoized per-process: at most one round-trip for the lifetime of the
// process, not one per query/request. Only a *successful* check (role
// confirmed non-bypassing) is cached; a failed attempt (e.g. the DB was
// briefly unreachable) is not cached, so a later call retries instead of
// leaving the process permanently poisoned by a transient error.
let runtimeRoleCheck: Promise<void> | undefined

async function queryCurrentRoleBypassRls(pool: Pool): Promise<RoleBypassRow> {
  const result = await pool.query<{ role: string; rolbypassrls: boolean }>(
    'select current_user as role, rolbypassrls from pg_roles where rolname = current_user',
  )
  const row = result.rows[0]
  if (!row) throw new Error('Could not determine the connecting database role (pg_roles lookup returned no row)')
  return row
}

/**
 * Runs once per process. Queries the connecting role's rolbypassrls and
 * throws if it can bypass RLS. Call this before the first tenant-scoped
 * query; do not call it per-query.
 */
export async function assertRuntimeRoleCannotBypassRls(pool: Pool): Promise<void> {
  if (!runtimeRoleCheck) {
    runtimeRoleCheck = queryCurrentRoleBypassRls(pool)
      .then((row) => assertRoleCannotBypassRls(row))
      .catch((error: unknown) => {
        runtimeRoleCheck = undefined // don't poison the process on a transient failure
        throw error
      })
  }
  return runtimeRoleCheck
}

/**
 * Runs work in a Neon transaction after establishing transaction-local RLS
 * context. Repositories receive only this scoped transaction, not a global DB.
 */
export async function withTenantContext<T>(
  input: TenantContext,
  work: (tx: TenantQueryTransaction) => Promise<T>,
): Promise<T> {
  const context = createTenantContext(input)
  const pool = createPool()
  await assertRuntimeRoleCannotBypassRls(pool)
  const client = await pool.connect()
  try {
    await client.query('begin')
    const tx: TenantQueryTransaction = {
      execute: async (statement, values) => {
        if (values) await client.query(statement, [...values])
        else await client.query(statement)
      },
      query: async <R>(statement: string, values?: readonly unknown[]) => {
        const result = values
          ? await client.query(statement, [...values])
          : await client.query(statement)
        return result.rows as R[]
      },
    }
    await establishTenantContext(tx, context)
    const result = await work(tx)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

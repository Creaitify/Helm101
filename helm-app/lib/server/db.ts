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

import 'server-only'
import { Pool } from '@neondatabase/serverless'
import { requireServerEnv } from './env'

const WRITE_VERBS = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|call|do)\b/i

/**
 * The bypass role can read across every tenant, so the only statements it may
 * ever run are reads. Rejects write verbs anywhere in the statement, which also
 * defeats stacked statements such as "select 1; delete from campaigns".
 */
export function assertReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (!normalized) throw new Error('Platform reads are read-only: empty statement')
  const isSelect = /^(select|with)\b/i.test(normalized)
  if (!isSelect) throw new Error(`Platform reads are read-only: statement must begin with select`)
  if (WRITE_VERBS.test(normalized)) throw new Error('Platform reads are read-only: write verb detected')
}

export interface PlatformReader {
  query<T>(statement: string, values?: readonly unknown[]): Promise<T[]>
}

/**
 * The single path permitted to use the RLS-bypassing reader role. Every
 * invocation writes an audit event through the normal pool before returning.
 */
export async function withPlatformReadContext<T>(
  actor: { userId: string },
  work: (read: PlatformReader) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: requireServerEnv('platformReaderUrl') })
  const client = await pool.connect()
  const statements: string[] = []
  try {
    const read: PlatformReader = {
      query: async <R>(statement: string, values?: readonly unknown[]) => {
        assertReadOnlyStatement(statement)
        statements.push(statement)
        const result = values
          ? await client.query(statement, [...values])
          : await client.query(statement)
        return result.rows as R[]
      },
    }
    return await work(read)
  } finally {
    client.release()
    await pool.end()
    await recordPlatformRead(actor.userId, statements)
  }
}

async function recordPlatformRead(userId: string, statements: readonly string[]) {
  const pool = new Pool({ connectionString: requireServerEnv('databaseUrl') })
  try {
    await pool.query(
      `insert into audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
       select id, 'system', $1, 'platform.cross_tenant_read', 'platform_admins', $2::jsonb
       from tenants order by created_at limit 1`,
      [userId, JSON.stringify({ statementCount: statements.length, statements })],
    )
  } finally {
    await pool.end()
  }
}

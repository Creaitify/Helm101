import 'server-only'
import { Pool } from '@neondatabase/serverless'
import { requireServerEnv } from './env'

const WRITE_VERBS = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|call|do)\b/i

// `\binto\b` catches `select ... into <table>`, which creates a table and
// would otherwise sail through this guard (it starts with `select` and
// contains no blacklisted verb). This can also reject an exotic legitimate
// query that happens to use "into" as an identifier or in some clause we
// haven't thought of — that trade-off is correct for a bypass path: a false
// positive here is a caller filing a bug, a false negative is a write
// against every tenant's data.
const INTO_CLAUSE = /\binto\b/i

/**
 * String-level checks below are defense in depth only — a fast fail-fast
 * layer that rejects obviously bad input before it reaches the database.
 * They are NOT the security boundary. The actual control is that every
 * statement here runs inside a Postgres `begin transaction read only`
 * block (see `withPlatformReadContext`): Postgres itself rejects any write
 * — INSERT/UPDATE/DELETE/DDL/SELECT INTO, and writes attempted by a called
 * function — with error 25006, regardless of how the statement is spelled
 * or what a stored function does internally. No regex can see into a
 * function body or reliably parse SQL; the database's transaction mode can
 * and does enforce this correctly. Do not extend this function's blacklist
 * in place of tightening the transaction-level control.
 */
export function assertReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (!normalized) throw new Error('Platform reads are read-only: empty statement')
  const isSelect = /^(select|with)\b/i.test(normalized)
  if (!isSelect) throw new Error(`Platform reads are read-only: statement must begin with select`)
  if (WRITE_VERBS.test(normalized)) throw new Error('Platform reads are read-only: write verb detected')
  if (INTO_CLAUSE.test(normalized)) throw new Error('Platform reads are read-only: into clause detected')
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
    // The real security boundary: Postgres refuses any write inside a
    // read-only transaction (error 25006) no matter how it's spelled,
    // including SELECT INTO and writes attempted by a called function.
    // The `assertReadOnlyStatement` checks above are fail-fast, not this.
    await client.query('begin transaction read only')
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
      const result = await work(read)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    }
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

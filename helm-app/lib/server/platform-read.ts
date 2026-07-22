import 'server-only'
import { Pool } from '@neondatabase/serverless'
import { requireServerEnv } from './env'

// Structural, not enumerative: a keyword blacklist can always be evaded by a
// spelling/verb it doesn't know about (see the semicolon-stacking bypasses
// this replaced: `refresh materialized view`, `vacuum full`, `lock table`,
// `analyze`, `set role`, none of which are "write verbs" in the traditional
// sense but all of which are illegitimate on this path). Rejecting any `;`
// outside a string literal closes the entire class of "smuggle a second
// statement after a leading select" bypasses at once, independent of what
// that second statement's verb is.
const WRITE_VERBS = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i

/**
 * Scans for a `;` that is not inside a single-quoted string literal,
 * tracking `''`-escaped quotes. A single trailing `;` (optionally followed
 * only by whitespace) at the very end of the already-trimmed statement is
 * allowed; anything else outside a literal is rejected.
 */
function hasStructuralSemicolon(normalized: string): boolean {
  let inString = false
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === "'") {
      if (inString && normalized[i + 1] === "'") {
        i++ // escaped quote ('') — stay inside the literal, skip both chars
        continue
      }
      inString = !inString
      continue
    }
    if (ch === ';' && !inString) {
      // Allowed only if this is the single trailing semicolon: nothing but
      // whitespace follows it to the end of the (already-trimmed) string.
      const rest = normalized.slice(i + 1)
      if (rest.trim() === '') return false
      return true
    }
  }
  return false
}

/**
 * String-level checks below are defense in depth / fail-fast only — they
 * reject obviously bad input before it reaches the database. They are NOT
 * the security boundary. The actual control is that every statement here
 * runs inside a Postgres `begin transaction read only` block (see
 * `withPlatformReadContext`): Postgres itself rejects any write —
 * INSERT/UPDATE/DELETE/DDL/SELECT INTO, and writes attempted by a called
 * function — with error 25006, regardless of how the statement is spelled or
 * what a stored function does internally. No regex can see into a function
 * body or reliably parse SQL; the database's transaction mode can and does
 * enforce this correctly. Do not extend this function's blacklist in place
 * of tightening the transaction-level control.
 */
export function assertReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (!normalized) throw new Error('Platform reads are read-only: empty statement')
  const isSelect = /^(select|with)\b/i.test(normalized)
  if (!isSelect) throw new Error('Platform reads are read-only: statement must begin with select')
  if (hasStructuralSemicolon(normalized)) {
    throw new Error('Platform reads are read-only: statement contains a semicolon outside a string literal')
  }
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
    // An audit-write failure must NEVER overwrite the outcome of the `try`
    // above. Node replaces a try block's return value / thrown error with
    // whatever a `finally` block throws, so an unguarded rejection here
    // would (a) silently discard a successful read's result, and (b) mask
    // the real error on the failure path with an unrelated audit error.
    // Swallowing here is deliberately correct — do NOT "fix" this by letting
    // the error propagate. Instead we log loudly so an audit outage is
    // visible in server logs without ever taking down (or corrupting the
    // result of) the read path it is meant to observe.
    try {
      await recordPlatformRead(actor.userId, statements)
    } catch (auditError) {
      console.error('platform-read audit write failed (read result/error is unaffected):', auditError)
    }
  }
}

async function recordPlatformRead(userId: string, statements: readonly string[]) {
  const pool = new Pool({ connectionString: requireServerEnv('databaseUrl') })
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Resolve the tenant id once and reuse it for BOTH the RLS context
    // (set_config) and the inserted row's tenant_id column, so they cannot
    // diverge. `audit_log` has `force row level security` with
    // `with check (tenant_id = helm_tenant_id())`; without setting
    // `app.tenant_id` first, helm_tenant_id() is NULL and the insert is
    // rejected (42501) under any role that isn't bypassrls. `tenants` has no
    // RLS, so this lookup needs no context of its own.
    const tenantResult = await client.query<{ id: string }>('select id from tenants order by created_at limit 1')
    const tenantId = tenantResult.rows[0]?.id
    if (!tenantId) throw new Error('platform-read audit: no tenant row exists to attribute the audit event to')
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId])
    await client.query(
      `insert into audit_log (tenant_id, actor_type, actor_id, action, target, metadata)
       values ($1, 'system', $2, 'platform.cross_tenant_read', 'platform_admins', $3::jsonb)`,
      [tenantId, userId, JSON.stringify({ statementCount: statements.length, statements })],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

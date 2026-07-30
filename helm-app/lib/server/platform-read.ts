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

function isDollarTagChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}

/**
 * Scans for a `;` that is not inside Postgres lexical structure that can
 * legitimately contain one: `'...'` string literals (`''` escapes), `E'...'`
 * / `e'...'` escape-strings (`\'` also escapes, in addition to `''`), `"..."`
 * quoted identifiers (`""` escapes), `$tag$...$tag$` dollar-quoted bodies
 * (tag may be empty), `-- ...` line comments (terminated by newline), and
 * `/* ... *\/` block comments, which Postgres nests. A single trailing `;`
 * (optionally followed only by whitespace) at the very end of the
 * already-trimmed statement is allowed; any other `;` found outside all of
 * the above is rejected as a structural (stacked-statement) semicolon.
 *
 * This must track Postgres lexical structure precisely: an apostrophe inside
 * a `--` or `/* *\/` comment (e.g. ordinary English like "don't") must NOT be
 * treated as opening a string literal, or the scanner desyncs for the rest
 * of the statement and a following real `;` is missed entirely.
 */
function hasStructuralSemicolon(normalized: string): boolean {
  const n = normalized.length
  let i = 0
  let blockCommentDepth = 0

  while (i < n) {
    const ch = normalized[i]

    // Block comments nest in Postgres; track depth so an inner */ doesn't
    // prematurely close an outer comment.
    if (blockCommentDepth > 0) {
      if (ch === '/' && normalized[i + 1] === '*') {
        blockCommentDepth++
        i += 2
        continue
      }
      if (ch === '*' && normalized[i + 1] === '/') {
        blockCommentDepth--
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === '/' && normalized[i + 1] === '*') {
      blockCommentDepth = 1
      i += 2
      continue
    }

    // Line comment: everything to end of line is inert, including any ' or ;.
    if (ch === '-' && normalized[i + 1] === '-') {
      i += 2
      while (i < n && normalized[i] !== '\n') i++
      continue
    }

    // E'...' / e'...' escape-string: both \' and '' escape the closing quote.
    if ((ch === 'E' || ch === 'e') && normalized[i + 1] === "'") {
      i += 2
      while (i < n) {
        if (normalized[i] === '\\' && i + 1 < n) {
          i += 2
          continue
        }
        if (normalized[i] === "'") {
          if (normalized[i + 1] === "'") {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }

    // Plain '...' string literal, '' escaped quote.
    if (ch === "'") {
      i++
      while (i < n) {
        if (normalized[i] === "'") {
          if (normalized[i + 1] === "'") {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }

    // "..." quoted identifier, "" escaped quote.
    if (ch === '"') {
      i++
      while (i < n) {
        if (normalized[i] === '"') {
          if (normalized[i + 1] === '"') {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }

    // $tag$...$tag$ dollar-quoted body; tag may be empty ($$...$$).
    if (ch === '$') {
      let j = i + 1
      let tag = ''
      while (j < n && isDollarTagChar(normalized[j])) {
        tag += normalized[j]
        j++
      }
      if (normalized[j] === '$') {
        const opener = '$' + tag + '$'
        const closeIdx = normalized.indexOf(opener, j + 1)
        if (closeIdx !== -1) {
          i = closeIdx + opener.length
          continue
        }
        // Unterminated dollar-quote: nothing after this can be structural
        // (Postgres itself would reject this statement as malformed).
        return false
      }
      // Bare `$` that isn't a dollar-quote opener (e.g. a parameter marker
      // like $1) — not special, fall through.
      i++
      continue
    }

    if (ch === ';') {
      // Allowed only if this is the single trailing semicolon: nothing but
      // whitespace follows it to the end of the (already-trimmed) string.
      const rest = normalized.slice(i + 1)
      if (rest.trim() === '') return false
      return true
    }

    i++
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
    // NOTHING in this `finally` block may be allowed to throw. Node replaces
    // a try block's return value / thrown error with whatever a `finally`
    // block itself throws, so ANY unguarded rejection here — not just the
    // audit write, but `client.release()` and `pool.end()` too, both of
    // which are real network operations against Neon's serverless driver and
    // can genuinely fail — would (a) silently discard a successful read's
    // result, and (b) mask the real error on the failure path with an
    // unrelated cleanup/audit error. Each of the three operations below is
    // therefore individually guarded so a failure in one can never suppress
    // another or the caller's outcome. The audit write is guaranteed to run
    // FIRST (before release/end) so an invocation is audited even if cleanup
    // subsequently fails — "every invocation writes an audit event" must
    // hold even when the connection teardown itself throws. Do NOT "fix"
    // this by removing a guard or reordering — that reintroduces the
    // clobbering/unaudited-invocation bug this structure exists to prevent.
    try {
      await recordPlatformRead(actor.userId, statements)
    } catch (auditError) {
      console.error('platform-read audit write failed (read result/error is unaffected):', auditError)
    }
    try {
      client.release()
    } catch (releaseError) {
      console.error('platform-read: client.release() failed:', releaseError)
    }
    try {
      await pool.end()
    } catch (endError) {
      console.error('platform-read: pool.end() failed:', endError)
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
    // If `error` happened at/before `begin` (e.g. connection-level failure),
    // the transaction may never have started, and issuing `rollback` here
    // can itself throw. An unguarded throw from this catch block would
    // replace `error` — the real cause — with that secondary rollback
    // failure, so callers (and the finally-block audit-failure log in
    // withPlatformReadContext) would see the wrong error. Swallow any
    // rollback failure and always rethrow the ORIGINAL error.
    try {
      await client.query('rollback')
    } catch {
      // Intentionally ignored — see comment above.
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

import 'server-only'
import { Pool } from '@neondatabase/serverless'
import { env, requireServerEnv } from './env'
import { createTenantContext, establishTenantContext, type TenantContext, type TenantQueryTransaction } from './tenant-context'

function createPool() {
  return new Pool({ connectionString: requireServerEnv('databaseUrl') })
}

/**
 * Thrown whenever the database could not be reached at all -- connection
 * refused, DNS failure, TLS failure, timeout, or a dropped socket. This app
 * uses the `Pool` (WebSocket) driver, NOT the `neon()` HTTP driver: a real
 * connect failure on this path does not arrive as a `NeonDbError` or even as
 * an `Error` with a `.code`/`.sourceError` -- it arrives as a raw
 * `ErrorEvent` with an empty message and no distinguishing fields at all
 * (verified directly against the installed driver; see task-11-fix3-report).
 * Structural sniffing of that shape downstream is impossible, so it is never
 * attempted: instead, the failure is classified HERE, at the one place the
 * connection state is actually known -- inside the try/catch wrapping
 * `pool.connect()` -- and re-thrown as this typed error. Callers (lib/data)
 * classify it with a plain `instanceof` check, exactly like RlsBypassError.
 */
export class DatabaseUnreachableError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the database (connection refused, DNS/TLS failure, or timeout)', { cause })
  }
}

/**
 * Plain-`Error` transport failures the Pool driver can throw from
 * `pool.connect()` that are NOT delivered as an `ErrorEvent` (verified
 * against the installed driver bundle). These are distinctive message
 * prefixes, not SQL error text, so matching on them here -- at the same
 * connect() boundary as the ErrorEvent case, not by sniffing an arbitrary
 * downstream error -- is safe.
 */
const TRANSPORT_FAILURE_MESSAGES = [
  'There was an error establishing an SSL connection',
  'timeout expired',
  'Connection terminated unexpectedly',
  'Cannot use a pool after calling end on the pool',
]

function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true // ErrorEvent and friends: not an Error instance at all
  return TRANSPORT_FAILURE_MESSAGES.some((prefix) => error.message.startsWith(prefix))
}

async function connectOrThrowUnreachable(pool: Pool) {
  try {
    return await pool.connect()
  } catch (error) {
    throw new DatabaseUnreachableError(error)
  }
}

export async function checkDatabaseConnection() {
  if (!env.databaseUrl) return { configured: false, connected: false }
  const pool = createPool()
  try {
    await pool.query('select 1 as connected')
    return { configured: true, connected: true }
  } catch (error) {
    throw new DatabaseUnreachableError(error)
  } finally {
    await pool.end()
  }
}

export interface RoleBypassRow {
  role: string
  rolbypassrls: boolean
}

/**
 * Dedicated error class for the RLS-bypass guard. Its message text does not
 * match any pattern in lib/data's isExpectedFallback, but relying on message
 * matching as the enforcement mechanism is fragile -- callers must instead
 * check `instanceof RlsBypassError` and re-throw unconditionally in every
 * environment, never falling back to fixtures. A misconfigured role that
 * silently disables tenant isolation must never be masked by a
 * plausible-looking fixture response.
 */
export class RlsBypassError extends Error {
  readonly role: string
  constructor(role: string) {
    super(
      `Refusing to serve tenant-scoped queries: the connecting database role "${role}" has ` +
        'rolbypassrls = true, which silently disables every RLS tenant-isolation policy. ' +
        'NEON_DATABASE_URL must authenticate as a non-bypassing runtime role (helm_app), never ' +
        'an owner/admin role. Run `npm run db:provision-app-role` to provision it, then point ' +
        'NEON_DATABASE_URL at that role.',
    )
    this.role = role
  }
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
    throw new RlsBypassError(row.role)
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
 *
 * Connection-establishment failures (assertRuntimeRoleCannotBypassRls's
 * probe query, and pool.connect() itself) are classified as
 * DatabaseUnreachableError HERE, at the boundary where "we never got a
 * connection" is knowable from position -- not by inspecting the error's
 * shape, which for this driver's WebSocket transport is an undifferentiated
 * `ErrorEvent` with no message and no code (see DatabaseUnreachableError's
 * doc comment). A failure from `client.query(...)` AFTER a connection was
 * successfully established is deliberately NOT reclassified: a SQL error
 * (bad column, constraint violation, etc.) on an already-open connection is
 * a real bug, not "no database here," and must keep propagating as-is so it
 * stays visible instead of being silently treated as a fallback-worthy
 * outage. The one exception is a mid-transaction transport failure (the
 * driver's plain-Error `TRANSPORT_FAILURE_MESSAGES`, e.g. a dropped
 * connection) -- arguably still "unreachable," so it is reclassified too.
 */
export async function withTenantContext<T>(
  input: TenantContext,
  work: (tx: TenantQueryTransaction) => Promise<T>,
): Promise<T> {
  const context = createTenantContext(input)
  const pool = createPool()
  try {
    await assertRuntimeRoleCannotBypassRls(pool)
  } catch (error) {
    await pool.end().catch(() => {})
    // RlsBypassError is a real, successfully-queried result (the role WAS
    // reached; it just fails the bypass check) -- never mask it as
    // "unreachable." Everything else here means the probe query itself
    // could not run, i.e. the database was unreachable.
    if (error instanceof RlsBypassError) throw error
    throw new DatabaseUnreachableError(error)
  }
  const client = await connectOrThrowUnreachable(pool)
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
    await client.query('rollback').catch(() => {})
    if (isTransportFailure(error) && !(error instanceof DatabaseUnreachableError)) {
      throw new DatabaseUnreachableError(error)
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

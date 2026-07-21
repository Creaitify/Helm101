import 'server-only'

export type TenantRole = 'owner' | 'agency_admin' | 'strategist' | 'creative' | 'analyst' | 'client_viewer'

export interface TenantContext {
  tenantId: string
  userId: string
  role: TenantRole
  scopes: readonly string[]
}

/**
 * Validates the server-authenticated identity contract before it reaches a
 * repository. The future auth adapter is the only code allowed to construct it.
 */
export function createTenantContext(input: TenantContext): Readonly<TenantContext> {
  if (!input.tenantId || !input.userId || !input.role) throw new Error('Incomplete tenant context')
  return Object.freeze({ ...input, scopes: Object.freeze([...input.scopes]) })
}

export interface TenantTransaction {
  execute(query: string, values?: readonly unknown[]): Promise<void>
}

/**
 * Sets Postgres transaction-local RLS context. Call this before every
 * tenant-owned query, inside the same transaction; never interpolate the id.
 */
export async function establishTenantContext(tx: TenantTransaction, context: TenantContext) {
  await tx.execute("select set_config('app.tenant_id', $1, true)", [context.tenantId])
}

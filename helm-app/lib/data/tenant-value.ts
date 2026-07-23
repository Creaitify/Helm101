import 'server-only'
import type { Tenant, Role } from '../types'
import { requireTenantContext } from '../server/tenant-session'
import { withTenantContext } from '../server/db'
import { getTenantById } from '../repositories/directory'
import { toUiRole } from '../server/role-mapping'
import { env } from '../server/env'

export interface CurrentTenantValue { tenant: Tenant; role: Role }

/**
 * Server-side seam for lib/tenant.tsx's TenantProvider. Resolves the caller's
 * real membership (via requireTenantContext, Task 8) and the tenant row it
 * points at (via getTenantById, Task 7), then maps the DB role to the UI role
 * vocabulary (toUiRole, Task 2).
 *
 * Returns undefined -- letting TenantProvider fall back to its Finnovate
 * default -- only when no database is configured (env.databaseUrl unset):
 * local dev without a live Neon connection should still render the shell.
 *
 * Any error requireTenantContext throws (UnauthenticatedError,
 * NoMembershipError) propagates to the caller instead of being swallowed
 * here: an authenticated user with no membership must not silently render a
 * tenant shell seeded with fabricated data. The (app) layout is expected to
 * catch NoMembershipError and redirect to /no-access.
 */
export async function getCurrentTenantValue(): Promise<CurrentTenantValue | undefined> {
  if (!env.databaseUrl) return undefined
  const context = await requireTenantContext()
  const tenant = await withTenantContext(context, (tx) => getTenantById(tx, context.tenantId))
  if (!tenant) return undefined
  return { tenant, role: toUiRole(context.role) }
}

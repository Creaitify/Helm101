import 'server-only'
import { createTenantContext, type TenantContext, type TenantRole } from './tenant-context'

export interface TenantMembership {
  tenantId: string
  userId: string
  role: TenantRole
  scopes: readonly string[]
}

export function tenantContextFromMembership(membership: TenantMembership): Readonly<TenantContext> {
  return createTenantContext(membership)
}

export function requireScope(context: TenantContext, scope: string) {
  if (!context.scopes.includes(scope)) throw new Error(`Missing required scope: ${scope}`)
}

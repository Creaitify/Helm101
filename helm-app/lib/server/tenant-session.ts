import 'server-only'
import { getServerSession } from 'next-auth'
import { Pool } from '@neondatabase/serverless'
import { authOptions } from '@/auth'
import { requireServerEnv } from './env'
import { createTenantContext, type TenantContext, type TenantRole } from './tenant-context'

export class NoMembershipError extends Error {
  constructor(email: string) { super(`No membership for ${email}`) }
}

export class UnauthenticatedError extends Error {
  constructor() { super('Authentication is required') }
}

const SCOPES: Record<TenantRole, readonly string[]> = {
  owner: ['analytics.read', 'campaigns.write', 'approvals.decide', 'integrations.manage', 'workspace.write'],
  agency_admin: ['analytics.read', 'campaigns.write', 'approvals.decide', 'integrations.manage', 'workspace.write'],
  strategist: ['analytics.read', 'campaigns.write', 'approvals.decide', 'workspace.write'],
  creative: ['analytics.read', 'approvals.decide', 'workspace.write'],
  analyst: ['analytics.read', 'workspace.write'],
  client_viewer: ['analytics.read'],
}

export const scopesForRole = (role: TenantRole): readonly string[] => SCOPES[role]

export interface Membership {
  tenantId: string
  tenantSlug: string
  userId: string
  role: TenantRole
  isPlatformAdmin: boolean
}

/**
 * Looks up an authenticated email in the users table. A missing row means no
 * access: the application never auto-provisions from an OAuth callback.
 */
export async function resolveMembership(email: string, activeTenantId?: string): Promise<Membership | null> {
  const pool = new Pool({ connectionString: requireServerEnv('databaseUrl') })
  try {
    const { rows } = await pool.query(
      `select u.id, u.tenant_id, u.role, t.slug,
              (pa.user_id is not null) as is_platform_admin
       from users u
       join tenants t on t.id = u.tenant_id
       left join platform_admins pa on pa.user_id = u.id
       where lower(u.email) = lower($1) and u.status = 'active'
       limit 1`,
      [email],
    )
    const row = rows[0]
    if (!row) return null

    let tenantId = row.tenant_id as string
    let tenantSlug = row.slug as string
    if (activeTenantId && row.is_platform_admin) {
      const switched = await pool.query('select id, slug from tenants where id = $1', [activeTenantId])
      if (switched.rows[0]) {
        tenantId = switched.rows[0].id
        tenantSlug = switched.rows[0].slug
      }
    }

    return {
      tenantId,
      tenantSlug,
      userId: row.id as string,
      role: row.role as TenantRole,
      isPlatformAdmin: Boolean(row.is_platform_admin),
    }
  } finally {
    await pool.end()
  }
}

// Task 10 Step 7 replaces this body to read the active-tenant cookie. The
// signature is argument-free from the start so no caller ever has to change.
export async function requireTenantContext(): Promise<Readonly<TenantContext>> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) throw new UnauthenticatedError()
  const membership = await resolveMembership(email)
  if (!membership) throw new NoMembershipError(email)
  return createTenantContext({
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role,
    scopes: scopesForRole(membership.role),
  })
}

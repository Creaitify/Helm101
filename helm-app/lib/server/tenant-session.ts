import 'server-only'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { Pool } from '@neondatabase/serverless'
import { authOptions } from '@/auth'
import { requireServerEnv } from './env'
import { createTenantContext, type TenantContext, type TenantRole } from './tenant-context'

export class NoMembershipError extends Error {
  readonly email: string
  constructor(email: string) {
    super('No membership for the authenticated user')
    this.email = email
  }
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

const KNOWN_ROLES = new Set(Object.keys(SCOPES))

export const scopesForRole = (role: TenantRole): readonly string[] => SCOPES[role]

/**
 * Validates a role value read from the database against the known scope
 * table, instead of trusting an unchecked cast. A future migration could add
 * a new `helm_role` enum value without a corresponding SCOPES entry; without
 * this check, `scopesForRole` would return `undefined` and a TenantContext
 * with `scopes: undefined` would silently propagate downstream.
 */
function assertKnownRole(role: string): TenantRole {
  if (!KNOWN_ROLES.has(role)) {
    throw new Error(`Unknown tenant role from database: ${role}`)
  }
  return role as TenantRole
}

/**
 * Matches a well-formed UUID (any RFC 4122 version/variant, not just v4) --
 * every id column this app compares an activeTenantId against (tenants.id,
 * users.tenant_id) is a Postgres `uuid`. Used as defense in depth in two
 * places: the switch route rejects a non-UUID before it is ever written to
 * the cookie, and resolveMembershipWith treats a malformed cookie value it
 * reads back as absent rather than letting it reach a `uuid`-typed query
 * parameter (which would 22P02 and 500 the whole (app) layout -- see the
 * Critical C1 fix notes on this file).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export interface Membership {
  tenantId: string
  tenantSlug: string
  userId: string
  role: TenantRole
  isPlatformAdmin: boolean
}

interface MembershipRow {
  id: string
  tenant_id: string
  slug: string
  role: string
  is_platform_admin: boolean
}

export interface QueryFn {
  <T>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>
}

/**
 * Selects among a user's (possibly several) OWN memberships only -- it never
 * looks at any other tenant. `users` is unique on `(tenant_id, email)`, not
 * globally unique on email, so one address can legitimately hold different
 * roles in different tenants. `rows` must already be in the function's
 * deterministic order (see migration 0008).
 *
 *  - If `activeTenantId` matches one of `rows` (i.e. one of the user's own
 *    memberships), that row is returned, with ITS role. Legitimate for any
 *    user, admin or not: they are a genuine member of that tenant.
 *  - Otherwise (activeTenantId unset, or set but not one of this user's own
 *    memberships) the first row in the deterministic order is returned.
 *
 * The cross-tenant admin path -- where a platform admin's activeTenantId
 * points at a tenant that is NOT one of their own memberships -- does not
 * live here. It is handled by the caller, resolveMembershipWith, directly
 * below: this function still returns the admin's own default membership row
 * (for identity/role-of-record), and the caller then overwrites tenantId/
 * tenantSlug via lookupTenantSlug only if isPlatformAdmin is true. That
 * split is also the forged-cookie defense: a non-admin whose activeTenantId
 * does not match any of their own memberships gets ONLY this function's
 * fallback (their default membership) because the caller's isPlatformAdmin
 * check gates the override -- never the requested tenant.
 */
function selectMembership(rows: readonly MembershipRow[], activeTenantId: string | undefined): MembershipRow {
  const own = activeTenantId ? rows.find((r) => r.tenant_id === activeTenantId) : undefined
  if (own) return own
  return rows[0]
}

async function lookupTenantSlug(query: QueryFn, tenantId: string): Promise<string | undefined> {
  // tenants has no RLS (see db/migrations/0001_foundations.sql), so this is a
  // direct query; excludes non-active tenants so a suspended/archived tenant
  // is never reachable via the cross-tenant admin path.
  const { rows } = await query<{ id: string; slug: string }>(
    "select id, slug from tenants where id = $1 and status = 'active'",
    [tenantId],
  )
  return rows[0]?.slug
}

/**
 * Looks up an authenticated email against ALL of that email's active
 * memberships (see migration 0008 / helm_lookup_membership). A missing row
 * means no access: the application never auto-provisions from an OAuth
 * callback.
 */
export async function resolveMembershipWith(
  query: QueryFn,
  email: string,
  activeTenantId?: string,
): Promise<Membership | null> {
  // Defense in depth (Critical C1): tenants.id and users.tenant_id are both
  // `uuid` columns. A malformed activeTenantId (e.g. a slug left over from
  // the old switcher, or any other garbage cookie value) must degrade to
  // "no requested tenant" here, BEFORE it can reach selectMembership's
  // comparison or lookupTenantSlug's query parameter -- otherwise Postgres
  // rejects it with SQLSTATE 22P02, which nothing here catches, and the
  // whole (app) layout 500s for every request until the cookie is cleared.
  // This is deliberately silent (no throw, no log): a stale/tampered cookie
  // is an expected condition the app must degrade gracefully from, not an
  // unexpected bug.
  if (activeTenantId !== undefined && !isUuid(activeTenantId)) {
    activeTenantId = undefined
  }
  // users has forced RLS keyed on app.tenant_id, which cannot be set before
  // identity is known. helm_lookup_membership is a SECURITY DEFINER function
  // that exposes exactly one narrow, parameterised path -- every active
  // membership row for a single email, deterministically ordered -- instead
  // of the whole table. See migration 0008 for the full rationale.
  const { rows } = await query<MembershipRow>(
    `select user_id as id, tenant_id, tenant_slug as slug, role, is_platform_admin
     from helm_lookup_membership($1)`,
    [email],
  )
  if (rows.length === 0) return null

  const isPlatformAdmin = rows.some((r) => r.is_platform_admin)
  const chosen = selectMembership(rows, activeTenantId)

  let tenantId = chosen.tenant_id
  let tenantSlug = chosen.slug
  const isOwnMembership = activeTenantId ? rows.some((r) => r.tenant_id === activeTenantId) : false

  // Cross-tenant admin path: only reached when activeTenantId does NOT match
  // any of the user's own memberships (selectMembership would already have
  // picked it otherwise) and the user is a platform admin.
  if (activeTenantId && !isOwnMembership && isPlatformAdmin) {
    const slug = await lookupTenantSlug(query, activeTenantId)
    if (slug) {
      tenantId = activeTenantId
      tenantSlug = slug
    }
  }

  return {
    tenantId,
    tenantSlug,
    userId: chosen.id,
    role: assertKnownRole(chosen.role),
    isPlatformAdmin,
  }
}

export async function resolveMembership(email: string, activeTenantId?: string): Promise<Membership | null> {
  const pool = new Pool({ connectionString: requireServerEnv('databaseUrl') })
  try {
    const query: QueryFn = async <T>(sql: string, values?: readonly unknown[]) => {
      const result = await pool.query(sql, values as unknown[] | undefined)
      return { rows: result.rows as T[] }
    }
    return await resolveMembershipWith(query, email, activeTenantId)
  } finally {
    await pool.end()
  }
}

export interface TenantSession {
  context: Readonly<TenantContext>
  membership: Membership
}

/**
 * Reads the `helm_active_tenant` cookie set by POST /api/tenant/switch and
 * passes it through to resolveMembership as the requested activeTenantId.
 * resolveMembership is the sole authority on whether that request is
 * honoured -- see selectMembership above for the full precedence, and note
 * in particular the forged-cookie defense: a non-admin's cookie pointing at
 * a tenant that is not their own is silently ignored there, not here.
 *
 * Returns the full Membership alongside the derived TenantContext so a
 * single caller needing both (e.g. the (app) layout, which needs the
 * TenantContext for tenant-scoped reads AND membership.isPlatformAdmin to
 * decide whether to show the tenant switcher) can resolve the session
 * exactly once instead of once per need.
 */
export async function resolveTenantSession(): Promise<TenantSession> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) throw new UnauthenticatedError()
  const store = await cookies()
  const activeTenantId = store.get('helm_active_tenant')?.value
  const membership = await resolveMembership(email, activeTenantId)
  if (!membership) throw new NoMembershipError(email)
  const context = createTenantContext({
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role,
    scopes: scopesForRole(membership.role),
  })
  return { context, membership }
}

/**
 * Convenience wrapper over resolveTenantSession for the common case where
 * only the TenantContext is needed. Kept as the primary export used by
 * repositories' single-purpose reads/writes (lib/data, the tenant-switch
 * route) so they don't need to know about Membership at all.
 */
export async function requireTenantContext(): Promise<Readonly<TenantContext>> {
  const { context } = await resolveTenantSession()
  return context
}

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scopesForRole, NoMembershipError, resolveMembershipWith, type QueryFn } from '@/lib/server/tenant-session'

const source = readFileSync(resolve(process.cwd(), 'lib/server/tenant-session.ts'), 'utf8')

// The exact query string resolveMembershipWith issues against
// helm_lookup_membership -- used to anchor the positive/negative regression
// assertions below to the actual query, not just anywhere in the file (a
// comment can otherwise satisfy a loose match).
const membershipQueryMatch = source.match(/query<MembershipRow>\(\s*(`[^`]*`)/)
const membershipQuery = membershipQueryMatch ? membershipQueryMatch[1] : ''

describe('tenant session', () => {
  it('grants owners every scope and viewers only reads', () => {
    expect(scopesForRole('owner')).toContain('approvals.decide')
    expect(scopesForRole('owner')).toContain('analytics.read')
    expect(scopesForRole('client_viewer')).toEqual(['analytics.read'])
  })

  it('does not let a viewer decide approvals', () => {
    expect(scopesForRole('client_viewer')).not.toContain('approvals.decide')
  })

  it('exposes a distinct error for an authenticated user with no membership', () => {
    const error = new NoMembershipError('stranger@example.com')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/no membership/i)
    // M2: email must not leak into the message string, only the property.
    expect(error.message).not.toContain('stranger@example.com')
    expect(error.email).toBe('stranger@example.com')
  })

  it('resolveMembership calls the SECURITY DEFINER lookup function, not a raw users join', () => {
    // Regression guard: `users` has forced RLS keyed on app.tenant_id, which
    // cannot be set before identity is known. Reverting to a direct
    // `from users` join here would silently break login for everyone (see
    // db/migrations/0008_membership_lookup_all.sql).
    expect(membershipQuery).toMatch(/from helm_lookup_membership\(\$1\)/)
    // Broadened beyond the exact spelling `from users u`: also catches
    // `from public.users`, `from "users"`, differing alias, etc.
    expect(membershipQuery).not.toMatch(/\bfrom\s+(public\.)?"?users"?\b/i)
  })
})

describe('resolveMembershipWith', () => {
  type Row = {
    id: string
    tenant_id: string
    slug: string
    role: string
    is_platform_admin: boolean
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  function fakeQuery(rows: Row[], tenantRows: { id: string; slug: string }[] = []): QueryFn {
    return async <T>(sql: string, values?: readonly unknown[]) => {
      if (/from helm_lookup_membership/.test(sql)) return { rows: rows as unknown as T[] }
      if (/from tenants/.test(sql)) {
        // Mirrors the real `uuid`-typed column: Postgres rejects a
        // non-UUID parameter with SQLSTATE 22P02 before rows are ever
        // considered -- this is what actually happened in production when
        // a slug reached this query (Critical C1).
        const id = values?.[0]
        if (typeof id === 'string' && !UUID_RE.test(id)) {
          const error = new Error(`invalid input syntax for type uuid: "${id}"`) as Error & { code: string }
          error.code = '22P02'
          throw error
        }
        return { rows: tenantRows as unknown as T[] }
      }
      throw new Error(`fakeQuery: unexpected sql: ${sql}`)
    }
  }

  // Real, DISTINCT UUIDs for tenant_id -- deliberately not reused as the
  // slug, unlike this file's previous 'tenant-a'/'mt-a' opaque strings,
  // which were equally plausible as either field and hid the slug-vs-UUID
  // confusion that caused Critical C1 (the tenant switcher sending a slug
  // where a UUID was required).
  const TENANT_A_UUID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_UUID = '22222222-2222-2222-2222-222222222222'
  const rowA: Row = { id: 'user-1', tenant_id: TENANT_A_UUID, slug: 'mt-a', role: 'client_viewer', is_platform_admin: false }
  const rowB: Row = { id: 'user-1', tenant_id: TENANT_B_UUID, slug: 'mt-b', role: 'owner', is_platform_admin: true }

  it('returns null when there are no rows', async () => {
    const result = await resolveMembershipWith(fakeQuery([]), 'nobody@example.com')
    expect(result).toBeNull()
  })

  it('returns the single membership when there is exactly one', async () => {
    const result = await resolveMembershipWith(fakeQuery([rowA]), 'solo@example.com')
    expect(result).toEqual({
      tenantId: TENANT_A_UUID,
      tenantSlug: 'mt-a',
      userId: 'user-1',
      role: 'client_viewer',
      isPlatformAdmin: false,
    })
  })

  it('with multiple memberships and no activeTenantId, deterministically picks the first ordered row', async () => {
    const result = await resolveMembershipWith(fakeQuery([rowA, rowB]), 'multi@example.com')
    expect(result?.tenantId).toBe(TENANT_A_UUID)
    expect(result?.role).toBe('client_viewer')
    // isPlatformAdmin reflects ANY membership, not just the chosen one.
    expect(result?.isPlatformAdmin).toBe(true)
  })

  it('when activeTenantId matches one of the user\'s own memberships, uses that membership with ITS role', async () => {
    const result = await resolveMembershipWith(fakeQuery([rowA, rowB]), 'multi@example.com', TENANT_B_UUID)
    expect(result?.tenantId).toBe(TENANT_B_UUID)
    expect(result?.tenantSlug).toBe('mt-b')
    expect(result?.role).toBe('owner')
  })

  it('forged-cookie defense: a non-admin with an activeTenantId that is not theirs falls back to their default membership', async () => {
    const forgedUuid = '99999999-9999-9999-9999-999999999999'
    const nonAdminRow: Row = { id: 'user-2', tenant_id: TENANT_A_UUID, slug: 'mt-a', role: 'client_viewer', is_platform_admin: false }
    // The forged target MUST be resolvable, otherwise this test passes for the
    // wrong reason: with no matching tenant row the switch would fail on the
    // slug lookup even if the platform-admin gate were deleted. Seeding it means
    // the ONLY thing preventing the switch is that gate. Verified by mutation:
    // removing `&& isPlatformAdmin` makes this test fail.
    const result = await resolveMembershipWith(
      fakeQuery([nonAdminRow], [{ id: forgedUuid, slug: 'forged-tenant' }]),
      'victim@example.com',
      forgedUuid,
    )
    expect(result?.tenantId).toBe(TENANT_A_UUID)
    expect(result?.tenantSlug).toBe('mt-a')
    expect(result?.role).toBe('client_viewer')
  })

  it('a platform admin with an activeTenantId that is not theirs is switched to that tenant', async () => {
    const targetUuid = '22222222-2222-2222-2222-222222222222'
    const adminRow: Row = { id: 'user-3', tenant_id: '33333333-3333-3333-3333-333333333333', slug: 'home', role: 'owner', is_platform_admin: true }
    const result = await resolveMembershipWith(
      fakeQuery([adminRow], [{ id: targetUuid, slug: 'target-tenant' }]),
      'admin@example.com',
      targetUuid,
    )
    expect(result?.tenantId).toBe(targetUuid)
    expect(result?.tenantSlug).toBe('target-tenant')
    // Role of record stays the admin's own default membership role.
    expect(result?.role).toBe('owner')
    expect(result?.userId).toBe('user-3')
  })

  it('throws on an unknown role instead of silently propagating an invalid TenantContext', async () => {
    const badRow: Row = { id: 'user-4', tenant_id: TENANT_A_UUID, slug: 'mt-a', role: 'nonexistent_role', is_platform_admin: false }
    await expect(resolveMembershipWith(fakeQuery([badRow]), 'weird@example.com')).rejects.toThrow(/unknown tenant role/i)
  })

  // Critical C1: Tenant.id is a slug (e.g. "finnovate"), not the tenants.id
  // uuid. Before the fix, the old switcher sent the slug, which landed in
  // the helm_active_tenant cookie and was read back here as activeTenantId,
  // reaching a `uuid`-typed query column and throwing 22P02 -- which
  // resolveMembershipWith did not catch, 500ing the whole (app) layout for
  // every request until the cookie was cleared. A malformed cookie must
  // degrade to the default membership, never reach the query layer.
  it('treats a malformed (non-UUID) activeTenantId as absent and falls back to the default membership', async () => {
    const rowA: Row = { id: 'user-1', tenant_id: '11111111-1111-1111-1111-111111111111', slug: 'finnovate', role: 'owner', is_platform_admin: true }
    // If a malformed cookie reached the query layer as-is, fakeQuery's
    // `from tenants` branch would be hit with a non-uuid value; asserting no
    // throw here proves the guard short-circuits before any query is issued
    // for the malformed value.
    const result = await resolveMembershipWith(fakeQuery([rowA]), 'admin@example.com', 'finnovate')
    expect(result).not.toBeNull()
    expect(result?.tenantId).toBe('11111111-1111-1111-1111-111111111111')
    expect(result?.tenantSlug).toBe('finnovate')
  })
})

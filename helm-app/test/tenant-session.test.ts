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

  function fakeQuery(rows: Row[], tenantRows: { id: string; slug: string }[] = []): QueryFn {
    return async <T>(sql: string) => {
      if (/from helm_lookup_membership/.test(sql)) return { rows: rows as unknown as T[] }
      if (/from tenants/.test(sql)) return { rows: tenantRows as unknown as T[] }
      throw new Error(`fakeQuery: unexpected sql: ${sql}`)
    }
  }

  const rowA: Row = { id: 'user-1', tenant_id: 'tenant-a', slug: 'mt-a', role: 'client_viewer', is_platform_admin: false }
  const rowB: Row = { id: 'user-1', tenant_id: 'tenant-b', slug: 'mt-b', role: 'owner', is_platform_admin: true }

  it('returns null when there are no rows', async () => {
    const result = await resolveMembershipWith(fakeQuery([]), 'nobody@example.com')
    expect(result).toBeNull()
  })

  it('returns the single membership when there is exactly one', async () => {
    const result = await resolveMembershipWith(fakeQuery([rowA]), 'solo@example.com')
    expect(result).toEqual({
      tenantId: 'tenant-a',
      tenantSlug: 'mt-a',
      userId: 'user-1',
      role: 'client_viewer',
      isPlatformAdmin: false,
    })
  })

  it('with multiple memberships and no activeTenantId, deterministically picks the first ordered row', async () => {
    const result = await resolveMembershipWith(fakeQuery([rowA, rowB]), 'multi@example.com')
    expect(result?.tenantId).toBe('tenant-a')
    expect(result?.role).toBe('client_viewer')
    // isPlatformAdmin reflects ANY membership, not just the chosen one.
    expect(result?.isPlatformAdmin).toBe(true)
  })

  it('when activeTenantId matches one of the user\'s own memberships, uses that membership with ITS role', async () => {
    const result = await resolveMembershipWith(fakeQuery([rowA, rowB]), 'multi@example.com', 'tenant-b')
    expect(result?.tenantId).toBe('tenant-b')
    expect(result?.tenantSlug).toBe('mt-b')
    expect(result?.role).toBe('owner')
  })

  it('forged-cookie defense: a non-admin with an activeTenantId that is not theirs falls back to their default membership', async () => {
    const nonAdminRow: Row = { id: 'user-2', tenant_id: 'tenant-a', slug: 'mt-a', role: 'client_viewer', is_platform_admin: false }
    const result = await resolveMembershipWith(fakeQuery([nonAdminRow]), 'victim@example.com', 'tenant-forged')
    expect(result?.tenantId).toBe('tenant-a')
    expect(result?.tenantSlug).toBe('mt-a')
    expect(result?.role).toBe('client_viewer')
  })

  it('a platform admin with an activeTenantId that is not theirs is switched to that tenant', async () => {
    const adminRow: Row = { id: 'user-3', tenant_id: 'tenant-home', slug: 'home', role: 'owner', is_platform_admin: true }
    const result = await resolveMembershipWith(
      fakeQuery([adminRow], [{ id: 'tenant-target', slug: 'target-tenant' }]),
      'admin@example.com',
      'tenant-target',
    )
    expect(result?.tenantId).toBe('tenant-target')
    expect(result?.tenantSlug).toBe('target-tenant')
    // Role of record stays the admin's own default membership role.
    expect(result?.role).toBe('owner')
    expect(result?.userId).toBe('user-3')
  })

  it('throws on an unknown role instead of silently propagating an invalid TenantContext', async () => {
    const badRow: Row = { id: 'user-4', tenant_id: 'tenant-a', slug: 'mt-a', role: 'nonexistent_role', is_platform_admin: false }
    await expect(resolveMembershipWith(fakeQuery([badRow]), 'weird@example.com')).rejects.toThrow(/unknown tenant role/i)
  })
})

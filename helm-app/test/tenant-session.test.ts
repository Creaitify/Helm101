import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scopesForRole, NoMembershipError } from '@/lib/server/tenant-session'

const source = readFileSync(resolve(process.cwd(), 'lib/server/tenant-session.ts'), 'utf8')

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
  })

  it('resolveMembership calls the SECURITY DEFINER lookup function, not a raw users join', () => {
    // Regression guard: `users` has forced RLS keyed on app.tenant_id, which
    // cannot be set before identity is known. Reverting to a direct
    // `from users` join here would silently break login for everyone (see
    // db/migrations/0007_membership_lookup.sql).
    expect(source).toMatch(/from helm_lookup_membership\(\$1\)/)
    expect(source).not.toMatch(/from\s+users\s+u/i)
  })
})

import { describe, it, expect } from 'vitest'
import { scopesForRole, NoMembershipError } from '@/lib/server/tenant-session'

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
})

import { describe, it, expect } from 'vitest'
import { toUiRole, toDbRole } from '@/lib/server/role-mapping'
import type { TenantRole } from '@/lib/server/tenant-context'

const DB_ROLES: TenantRole[] = ['owner', 'agency_admin', 'strategist', 'creative', 'analyst', 'client_viewer']

describe('role mapping', () => {
  it('maps the database enum to UI role names', () => {
    expect(toUiRole('owner')).toBe('master')
    expect(toUiRole('agency_admin')).toBe('agency')
    expect(toUiRole('client_viewer')).toBe('viewer')
    expect(toUiRole('strategist')).toBe('strategist')
  })

  it('round-trips every database role', () => {
    for (const role of DB_ROLES) {
      expect(toDbRole(toUiRole(role))).toBe(role)
    }
  })
})

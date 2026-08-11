import { describe, it, expect } from 'vitest'
import { toUiRole, assertCanonicalRole, type CanonicalRole } from '@/lib/server/role-mapping'

const CANONICAL_ROLES: CanonicalRole[] = ['owner', 'agency_admin', 'strategist', 'creative', 'analyst', 'client_viewer']

describe('role mapping', () => {
  it('maps every canonical API role to a UI role name', () => {
    expect(toUiRole('owner')).toBe('master')
    expect(toUiRole('agency_admin')).toBe('agency')
    expect(toUiRole('client_viewer')).toBe('viewer')
    expect(toUiRole('strategist')).toBe('strategist')
    expect(toUiRole('creative')).toBe('creative')
    expect(toUiRole('analyst')).toBe('analyst')
  })

  it('accepts every canonical role string from the API', () => {
    for (const role of CANONICAL_ROLES) {
      expect(assertCanonicalRole(role)).toBe(role)
    }
  })

  // An unrecognized role is a contract break between the services, not a
  // "default to viewer" case -- it must fail loud at the seam.
  it('throws on an unknown role string', () => {
    expect(() => assertCanonicalRole('superuser')).toThrow(/Unknown canonical role/)
    expect(() => assertCanonicalRole('')).toThrow(/Unknown canonical role/)
  })

  // Prototype-inherited hazard: `master`/`agency`/`viewer` are UI labels,
  // not API roles -- they must never round-trip back in as canonical.
  it('rejects UI vocabulary as canonical input', () => {
    expect(() => assertCanonicalRole('master')).toThrow(/Unknown canonical role/)
    expect(() => assertCanonicalRole('viewer')).toThrow(/Unknown canonical role/)
  })
})

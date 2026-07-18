import { describe, it, expect } from 'vitest'
import { can } from '@/lib/rbac'

describe('rbac', () => {
  it('only master sees the Master Console', () => {
    expect(can('master', 'masterConsole')).toBe(true)
    expect(can('agency', 'masterConsole')).toBe(false)
    expect(can('viewer', 'masterConsole')).toBe(false)
  })
  it('everyone can view analytics', () => {
    expect(can('viewer', 'viewAnalytics')).toBe(true)
  })
})

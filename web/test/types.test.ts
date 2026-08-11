import { describe, it, expect } from 'vitest'
import type { KpiMetric, Role } from '@/lib/types'

describe('types', () => {
  it('KpiMetric shape compiles and constructs', () => {
    const k: KpiMetric = { label: 'CAC', value: '₹412', deltaLabel: '▲ 12%', direction: 'up', sparkline: [1,2,3], color: 'emerald' }
    expect(k.direction).toBe('up')
  })
  it('Role union', () => { const r: Role = 'master'; expect(r).toBe('master') })
})

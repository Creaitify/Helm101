import { describe, it, expect } from 'vitest'
import { inr, pct, compact, deltaDirection } from '@/lib/format'

describe('format', () => {
  it('inr uses lakh/crore', () => {
    expect(inr(412)).toBe('₹412')
    expect(inr(496000)).toBe('₹4.96L')
    expect(inr(12000000)).toBe('₹1.20Cr')
  })
  it('compact', () => { expect(compact(2140000)).toBe('2.14M'); expect(compact(842000)).toBe('842K') })
  it('pct', () => { expect(pct(3.1)).toBe('3.10%') })
  it('deltaDirection respects lowerIsBetter', () => {
    expect(deltaDirection(412, 468, true)).toBe('up')   // CAC dropped -> good -> 'up'
    expect(deltaDirection(468, 412, true)).toBe('down')
    expect(deltaDirection(1204, 1112)).toBe('up')
  })
})

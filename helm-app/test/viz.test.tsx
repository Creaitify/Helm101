import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatTile } from '@/components/viz/StatTile'
import { RadialGauge } from '@/components/viz/RadialGauge'

describe('viz', () => {
  it('StatTile shows label, value, delta', () => {
    render(<StatTile metric={{ label: 'CAC', value: '₹412', deltaLabel: '▲ 12%', direction: 'up', sparkline: [1,2,1,3], color: 'emerald' }} />)
    expect(screen.getByText('CAC')).toBeInTheDocument()
    expect(screen.getByText('₹412')).toBeInTheDocument()
    expect(screen.getByText('▲ 12%')).toBeInTheDocument()
  })
  it('RadialGauge renders its percentage label', () => {
    render(<RadialGauge pct={81} color="emerald" label="CAC" />)
    expect(screen.getByText('81%')).toBeInTheDocument()
  })
})

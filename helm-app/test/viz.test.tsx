import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatTile } from '@/components/viz/StatTile'
import { RadialGauge } from '@/components/viz/RadialGauge'
import { FunnelChart } from '@/components/viz/FunnelChart'

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
  it('FunnelChart renders a conversion caption between its two stages', () => {
    const stages = [
      { label: 'Impressions', value: 100, display: '100', widthPct: 100 },
      { label: 'Clicks', value: 62, display: '62', widthPct: 62, convLabel: '3.1% CTR' },
    ]
    const { container } = render(<FunnelChart stages={stages} />)
    const text = container.textContent || ''
    expect(text.indexOf('3.1% CTR')).toBeGreaterThan(text.indexOf('Impressions'))
    expect(text.indexOf('3.1% CTR')).toBeLessThan(text.indexOf('Clicks'))
  })
})

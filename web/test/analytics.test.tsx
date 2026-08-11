import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AnalyticsPage from '@/app/(app)/analytics/page'

describe('analytics page', () => {
  it('renders KPI labels from data', async () => {
    render(await AnalyticsPage())
    expect(await screen.findByText('Cost per Checkup')).toBeInTheDocument()
    expect(screen.getByText('Live Activity')).toBeInTheDocument()
  })
})

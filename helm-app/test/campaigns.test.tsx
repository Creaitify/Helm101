import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CampaignsView } from '@/app/(app)/campaigns/CampaignsView'
import { campaignsFull } from '@/lib/data/mock/fixtures'

describe('CampaignsView', () => {
  it('filters the list by search text', async () => {
    render(<CampaignsView campaigns={campaignsFull} />)
    expect(screen.getByText('FHC · Retargeting')).toBeInTheDocument()
    expect(screen.getByText('Search · Brand')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'Retargeting')
    expect(screen.getByText('FHC · Retargeting')).toBeInTheDocument()
    expect(screen.queryByText('Search · Brand')).not.toBeInTheDocument()
  })
  it('opens the detail drawer on row click', async () => {
    render(<CampaignsView campaigns={campaignsFull} />)
    await userEvent.click(screen.getByText('FHC · Retargeting'))
    expect(await screen.findByText(/Ad groups/i)).toBeInTheDocument()
    expect(screen.getByText(/Lowest CAC/i)).toBeInTheDocument()
  })
})

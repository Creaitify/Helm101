import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CampaignsView } from '@/app/(app)/campaigns/CampaignsView'
import { campaignsFull, campaignDetail } from '@/lib/data/mock/fixtures'

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
  it('sorts rows when a column header is selected', async () => {
    render(<CampaignsView campaigns={campaignsFull} />)
    await userEvent.click(screen.getByRole('button', { name: /sort by cac/i }))
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Search · Brand')
  })
})

// MINOR E: two rapid clicks must not let an older, slower response clobber
// the drawer with stale data after a newer click has already been made.
describe('CampaignsView: interleaved drawer fetches', () => {
  it('ignores a stale response from an earlier request once a newer request has been made', async () => {
    vi.doMock('@/app/(app)/campaigns/actions', () => ({
      fetchCampaignDetail: vi.fn(async (id: string) => {
        // c1 (clicked first) resolves AFTER c2 (clicked second): a naive
        // implementation would let c1's late response overwrite c2's detail.
        if (id === 'c1') await new Promise((r) => setTimeout(r, 30))
        return campaignDetail(id)
      }),
    }))
    vi.resetModules()
    const { CampaignsView: FreshCampaignsView } = await import('@/app/(app)/campaigns/CampaignsView')
    const user = userEvent.setup({ delay: null })
    render(<FreshCampaignsView campaigns={campaignsFull} />)

    // Each click's onClick handler kicks off openDetail without the click
    // handler itself awaiting its completion, so awaiting user.click here
    // only awaits event dispatch, not fetchCampaignDetail's 30ms delay --
    // both requests are in flight together, exactly as a real double-click
    // would leave them.
    await user.click(screen.getByText('FHC · Retargeting')) // c1, slow
    await user.click(screen.getByText('FHC · Lookalike 2%')) // c2, fast

    expect(await screen.findByText(/Scale prospecting/i)).toBeInTheDocument()
    // Wait past c1's artificial delay; its stale response must not appear.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Lowest CAC/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Scale prospecting/i)).toBeInTheDocument()

    vi.doUnmock('@/app/(app)/campaigns/actions')
    vi.resetModules()
  })
})

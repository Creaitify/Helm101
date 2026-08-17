import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildVariants } from '@/lib/studio'
import { StudioView } from '@/app/(app)/studio/StudioView'
import { briefDefaults } from '@/lib/data/mock/fixtures'

vi.mock('@/app/(app)/studio/actions', () => ({
  generateLiveVariants: vi.fn().mockResolvedValue([]),
  getGovernorVariantsAction: vi.fn().mockResolvedValue([]),
  shipVariantToCampaign: vi.fn().mockResolvedValue(true),
}))

describe('studio', () => {
  it('buildVariants returns 6 variants with at least one flagged', () => {
    const vs = buildVariants(briefDefaults)
    expect(vs.length).toBe(6)
    expect(vs.some((v) => v.compliance === 'flag')).toBe(true)
  })
  it('generate transitions to variants; ship moves a passing variant to Shipped', async () => {
    render(<StudioView brief={briefDefaults} />)
    await userEvent.click(screen.getByRole('button', { name: /generate/i }))
    const shipButtons = await screen.findAllByRole('button', { name: /^ship$/i })
    expect(shipButtons.length).toBeGreaterThan(0)
    await userEvent.click(shipButtons[0])
    expect(await screen.findByText(/Shipped/i)).toBeInTheDocument()
  })
  it('requires acknowledgement before a flagged variant can ship', async () => {
    render(<StudioView brief={briefDefaults} />)
    await userEvent.click(screen.getByRole('button', { name: /generate/i }))
    const acknowledge = await screen.findByRole('button', { name: /acknowledge risk/i })
    const card = acknowledge.closest('.var') as HTMLElement
    expect(within(card).getByRole('button', { name: /^ship$/i })).toBeDisabled()
    await userEvent.click(acknowledge)
    expect(within(card).getByRole('button', { name: /^ship$/i })).toBeEnabled()
  })
})

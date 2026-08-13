import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProvenanceBanner } from '@/components/shell/ProvenanceBanner'

/**
 * The banner is the honesty seam: until Phase 2 lands, lib/data serves
 * fixtures in both modes, so every shell render must say where its numbers
 * come from. These tests pin the wording's load-bearing words, not the prose.
 */
describe('ProvenanceBanner', () => {
  it('labels demo mode as synthetic end to end', () => {
    render(<ProvenanceBanner mode="demo" />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/demo mode/i)
    expect(note).toHaveTextContent(/synthetic/i)
    expect(note.dataset.mode).toBe('demo')
  })

  it('labels live mode as a preview with sample domain data, not as fully live', () => {
    render(<ProvenanceBanner mode="live" />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/sample data/i)
    expect(note).toHaveTextContent(/workspace chat is live/i)
    expect(note.dataset.mode).toBe('live')
  })
})

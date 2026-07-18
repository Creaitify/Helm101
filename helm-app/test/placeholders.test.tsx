import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Campaigns from '@/app/(app)/campaigns/page'

describe('placeholders', () => {
  it('campaigns renders an EmptyState heading', () => {
    render(<Campaigns />)
    expect(screen.getByRole('heading', { name: /Campaigns/i })).toBeInTheDocument()
  })
})

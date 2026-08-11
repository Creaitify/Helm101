import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { TopBar } from '@/components/shell/TopBar'

describe('a11y', () => {
  it('icon-only buttons have accessible names', () => {
    render(<TopBar />)
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })
})

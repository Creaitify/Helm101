import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { Sidebar } from '@/components/shell/Sidebar'

describe('sidebar', () => {
  it('shows Master Console items for master role', () => {
    render(<Sidebar role="master" />)
    expect(screen.getByText('Agent Fleet')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })
  it('hides Master Console items for viewer role', () => {
    render(<Sidebar role="viewer" />)
    expect(screen.queryByText('Agent Fleet')).not.toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })
})

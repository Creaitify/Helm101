import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { ApprovalsProvider } from '@/lib/approvals'
import { Sidebar } from '@/components/shell/Sidebar'

describe('approvals badge', () => {
  it('sidebar shows the provider pending count', () => {
    render(<ApprovalsProvider><Sidebar role="master" /></ApprovalsProvider>)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

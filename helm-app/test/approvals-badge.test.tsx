import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { ApprovalsProvider, useApprovals } from '@/lib/approvals'
import { Sidebar } from '@/components/shell/Sidebar'

function Setter({ n }: { n: number }) {
  const { setPending } = useApprovals()
  return <button onClick={() => setPending(n)}>set</button>
}

describe('approvals badge', () => {
  it('sidebar shows the provider pending count', () => {
    render(<ApprovalsProvider><Sidebar role="master" /></ApprovalsProvider>)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

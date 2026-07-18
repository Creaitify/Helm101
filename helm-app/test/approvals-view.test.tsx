import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApprovalsView } from '@/app/(app)/approvals/ApprovalsView'
import { ApprovalsProvider, useApprovals } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { approvals } from '@/lib/data/mock/fixtures'

function Count() { const { pending } = useApprovals(); return <div data-testid="count">{pending}</div> }

function wrap(ui: React.ReactNode) {
  return <ApprovalsProvider><ToastProvider>{ui}<Count /></ToastProvider></ApprovalsProvider>
}

describe('ApprovalsView', () => {
  it('approving removes the item and decrements the pending count', async () => {
    render(wrap(<ApprovalsView items={approvals} />))
    expect(screen.getByTestId('count').textContent).toBe('3')
    expect(screen.getByText('+₹15K to Lookalike 2%')).toBeInTheDocument()
    const firstCard = screen.getByText('+₹15K to Lookalike 2%').closest('.appr-card') as HTMLElement
    await userEvent.click(within(firstCard).getByRole('button', { name: /approve/i }))
    expect(screen.queryByText('+₹15K to Lookalike 2%')).not.toBeInTheDocument()
    expect(screen.getByTestId('count').textContent).toBe('2')
  })
})

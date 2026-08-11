import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/Toast'
import { IntegrationsView } from '@/app/(app)/integrations/IntegrationsView'
import { integrationsFull } from '@/lib/data/mock/fixtures'

describe('IntegrationsView', () => {
  it('connecting a disconnected connector flips it to healthy', async () => {
    render(<ToastProvider><IntegrationsView integrations={integrationsFull} /></ToastProvider>)
    const card = screen.getByText('Segment').closest('.int-card') as HTMLElement
    expect(within(card).getByText('disconnected')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /connect/i }))
    expect(within(card).getByText('healthy')).toBeInTheDocument()
  })
})

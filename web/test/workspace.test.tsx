import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cannedReply } from '@/lib/workspace'
import { WorkspaceView } from '@/app/(app)/workspace/WorkspaceView'
import { promptTemplates } from '@/lib/data/mock/fixtures'

describe('workspace', () => {
  it('cannedReply returns text + citations', () => {
    const r = cannedReply('summarise CAC')
    expect(r.text.length).toBeGreaterThan(0)
    expect(r.citations.length).toBeGreaterThan(0)
  })
  it('clicking a prompt template inserts its text into the input', async () => {
    render(<WorkspaceView templates={promptTemplates} />)
    await userEvent.click(screen.getByText('Ad brief'))
    const input = screen.getByPlaceholderText(/ask anything/i) as HTMLTextAreaElement
    expect(input.value).toMatch(/ad brief/i)
  })
  it('sending a message appends the user text and an assistant reply', async () => {
    render(<WorkspaceView templates={promptTemplates} />)
    const input = screen.getByPlaceholderText(/ask anything/i)
    await userEvent.type(input, 'How is CAC trending?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByText('How is CAC trending?')).toBeInTheDocument()
    expect(await screen.findByText(/HELM/i, {}, { timeout: 3000 })).toBeInTheDocument()
  })
  it('shows a selected file as an attachment chip', async () => {
    render(<WorkspaceView templates={promptTemplates} />)
    await userEvent.upload(screen.getByLabelText(/attach file/i), new File(['brief'], 'brief.pdf', { type: 'application/pdf' }))
    expect(screen.getByText(/attached: brief.pdf/i)).toBeInTheDocument()
  })
})

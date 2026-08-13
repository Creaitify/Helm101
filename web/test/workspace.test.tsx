import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cannedReply } from '@/lib/workspace'
import { promptTemplates } from '@/lib/data/mock/fixtures'

const { askWorkspaceQuestion } = vi.hoisted(() => ({ askWorkspaceQuestion: vi.fn() }))
vi.mock('@/app/(app)/workspace/actions', () => ({ askWorkspaceQuestion }))

import { WorkspaceView } from '@/app/(app)/workspace/WorkspaceView'

beforeEach(() => {
  askWorkspaceQuestion.mockReset()
})

const DEMO_RESULT = {
  ok: true as const,
  text: 'CAC is trending down.',
  citations: [{ label: 'CAC · 30d', source: 'Analytics' }],
  grounded: true,
  live: false,
}

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

  it('sending routes the question through the action and reveals the reply', async () => {
    askWorkspaceQuestion.mockResolvedValue(DEMO_RESULT)
    render(<WorkspaceView templates={promptTemplates} />)
    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'How is CAC trending?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(askWorkspaceQuestion).toHaveBeenCalledWith('How is CAC trending?', [])
    expect(screen.getByText('How is CAC trending?')).toBeInTheDocument()
    // Demo replies keep the mockup's model attribution prefix.
    expect(await screen.findByText(/HELM · Claude: CAC is trending down\./)).toBeInTheDocument()
    expect(screen.getByText('CAC · 30d')).toBeInTheDocument()
  })

  it('a follow-up carries the completed thread as history', async () => {
    askWorkspaceQuestion.mockResolvedValue({ ...DEMO_RESULT, live: true })
    render(<WorkspaceView templates={promptTemplates} live />)
    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'first question')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await screen.findByText('CAC is trending down.')

    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'tell me more')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(askWorkspaceQuestion).toHaveBeenLastCalledWith('tell me more', [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'CAC is trending down.' },
    ])
  })

  it('a live reply is shown verbatim — no fabricated model attribution', async () => {
    askWorkspaceQuestion.mockResolvedValue({ ...DEMO_RESULT, live: true })
    render(<WorkspaceView templates={promptTemplates} live />)
    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'What blocks sign-in?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText('CAC is trending down.')).toBeInTheDocument()
    expect(screen.queryByText(/HELM · Claude/)).not.toBeInTheDocument()
  })

  it('an ungrounded live answer is labelled, not passed off as verified', async () => {
    askWorkspaceQuestion.mockResolvedValue({ ...DEMO_RESULT, live: true, grounded: false, citations: [] })
    render(<WorkspaceView templates={promptTemplates} live />)
    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'Anything')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText(/ungrounded/i)).toBeInTheDocument()
  })

  it('a failure surfaces as a readable message in the thread, keyed by code', async () => {
    askWorkspaceQuestion.mockResolvedValue({ ok: false, code: 'budget_exceeded' })
    render(<WorkspaceView templates={promptTemplates} live />)
    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'Anything')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText(/budget .* exhausted/i)).toBeInTheDocument()
    // The input is usable again after a failure.
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled()
  })

  it('disables Send while a question is in flight', async () => {
    let release!: (v: typeof DEMO_RESULT) => void
    askWorkspaceQuestion.mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<WorkspaceView templates={promptTemplates} />)
    await userEvent.type(screen.getByPlaceholderText(/ask anything/i), 'Slow one')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    // The accessible name stays "Send" (aria-label); the visible text flips.
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
    expect(screen.getByText(/asking/i)).toBeInTheDocument()
    release(DEMO_RESULT)
    await screen.findByText(/CAC is trending down/)
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled()
  })

  it('shows a selected file as an attachment chip', async () => {
    render(<WorkspaceView templates={promptTemplates} />)
    await userEvent.upload(screen.getByLabelText(/attach file/i), new File(['brief'], 'brief.pdf', { type: 'application/pdf' }))
    expect(screen.getByText(/attached: brief.pdf/i)).toBeInTheDocument()
  })
})

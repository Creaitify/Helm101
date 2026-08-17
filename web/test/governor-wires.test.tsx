import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from '@/app/(app)/workspace/WorkspaceView'
import { AgentConsole } from '@/app/(app)/agents/AgentConsole'
import { StudioView } from '@/app/(app)/studio/StudioView'
import * as studioActions from '@/app/(app)/studio/actions'

const { executeAgent, decideAgent, inspectAgent, askWorkspaceQuestion, getModelConfig, setActiveModel } = vi.hoisted(() => ({
  executeAgent: vi.fn(),
  decideAgent: vi.fn(),
  inspectAgent: vi.fn(),
  askWorkspaceQuestion: vi.fn(),
  getModelConfig: vi.fn().mockResolvedValue({ ok: true, active: null, defaultByTask: {}, available: [] }),
  setActiveModel: vi.fn().mockResolvedValue({ ok: true, active: null, defaultByTask: {}, available: [] }),
}))

vi.mock('@/app/(app)/agents/actions', () => ({
  executeAgent,
  decideAgent,
  inspectAgent,
  getModelConfig,
  setActiveModel,
}))

vi.mock('@/app/(app)/workspace/actions', () => ({
  askWorkspaceQuestion,
  getWorkspaceThreadsAction: vi.fn().mockResolvedValue([]),
  getThreadDetailAction: vi.fn().mockResolvedValue(null),
  createThreadAction: vi.fn().mockImplementation((title: string) => Promise.resolve({ id: 't1', title, isPinned: false, updatedAt: new Date().toISOString() })),
  updateThreadAction: vi.fn().mockResolvedValue(null),
  deleteThreadAction: vi.fn().mockResolvedValue(true),
  saveMessageAction: vi.fn().mockResolvedValue({ id: 'm1' }),
}))

describe('Governor Relay 4 Wires', () => {
  beforeEach(() => {
    executeAgent.mockReset()
    decideAgent.mockReset()
    inspectAgent.mockReset()
    askWorkspaceQuestion.mockReset()
  })

  // Wire 1: Workspace → Agents Bridge Button
  describe('Wire 1: Workspace Bridge to Governor', () => {
    it('renders "Launch as Governor Mission" link on assistant messages', async () => {
      askWorkspaceQuestion.mockResolvedValue({
        ok: true,
        text: 'Financial Health Checkup CAC is ₹420 with high conversion velocity on Meta.',
        citations: [{ label: 'Q3 Report', source: 'Finnovate Corpus' }],
        grounded: true,
        live: true,
      })

      render(<WorkspaceView templates={[]} />)
      const input = screen.getByPlaceholderText(/Ask anything/i)
      await userEvent.type(input, 'What is the CAC for the ₹999 checkup?')
      await userEvent.click(screen.getByRole('button', { name: /Send/i }))

      const bridgeLink = await screen.findByRole('link', { name: /Launch as Governor Mission/i })
      expect(bridgeLink).toBeInTheDocument()
      expect(bridgeLink).toHaveAttribute(
        'href',
        expect.stringContaining('/agents?objective=What%20is%20the%20CAC%20for%20the%20%E2%82%B9999%20checkup%3F')
      )
    })
  })

  // Wire 2: Agents → Approvals (HITL Proposals & Link)
  describe('Wire 2: Agents to Approvals', () => {
    it('shows "View in Approvals" link when Governor is awaiting approval', async () => {
      executeAgent.mockResolvedValue({
        ok: true,
        runId: 'gv-relay-hitl-1',
        agent: 'governor',
        status: 'awaiting_approval',
        isAwaitingApproval: true,
        interruptPayload: {
          action: 'execute_governor_relay',
          summary: 'Growth push for ₹999 checkup',
          shifts: [{ campaign_id: 'fhc-meta', current_budget: 40000, proposed_budget: 50000, reason: 'High ROAS' }],
          variants: [{ headline: 'Transparent Wealth Check', body: 'SEBI reviewed roadmap.' }],
          checks: [{ label: '±25% Budget Cap', status: 'pass' }],
        },
        state: { hops: [] },
      })

      render(<AgentConsole />)
      await userEvent.click(screen.getByRole('button', { name: /Dispatch Mission/i }))

      const approvalsLink = await screen.findByRole('link', { name: /View in Approvals/i })
      expect(approvalsLink).toBeInTheDocument()
      expect(approvalsLink).toHaveAttribute('href', '/approvals')
    })
  })

  // Wire 3: Agents → Studio (Governor Creative Variants Flow)
  describe('Wire 3: Agents to Studio Creative Variants', () => {
    it('renders "From Governor Missions" section in Studio and allows shipping', async () => {
      const mockGovernorVariants = [
        {
          id: 'gv-v1',
          kind: 'image' as const,
          headline: 'SEBI Verified Wealth Check',
          body: 'Get ₹999 financial advisory session.',
          grad: ['violet', 'sky'] as [any, any],
          compliance: 'pass' as const,
          runId: 'gv-run-99',
          missionTag: 'Mission #gv-run-99',
        },
      ]

      vi.spyOn(studioActions, 'getGovernorVariantsAction').mockResolvedValue(mockGovernorVariants)

      render(
        <StudioView
          brief={{
            audience: 'Young Professionals',
            hook: 'Financial Health Checkup',
            offer: '₹999 Checkup',
            format: 'image',
          }}
        />
      )

      expect(await screen.findByText(/From Governor Missions/i)).toBeInTheDocument()
      expect(screen.getByText('SEBI Verified Wealth Check')).toBeInTheDocument()
      expect(screen.getByText('Mission #gv-run-99')).toBeInTheDocument()

      const shipBtn = screen.getByRole('button', { name: 'Ship' })
      await userEvent.click(shipBtn)

      expect(await screen.findByText(/Shipped to Production/i)).toBeInTheDocument()
    })
  })

  // Wire 4: Mission Dispatcher UI Feel
  describe('Wire 4: Mission Dispatcher UI Feel', () => {
    it('renders Governor preset chips and Dispatch Mission button', () => {
      render(<AgentConsole />)
      expect(screen.getByRole('button', { name: /Dispatch Mission/i })).toBeInTheDocument()
      expect(screen.getByText('Preset Objectives:')).toBeInTheDocument()
      expect(screen.getByText('Preset 1')).toBeInTheDocument()
      expect(screen.getByText('Preset 2')).toBeInTheDocument()
      expect(screen.getByText('Preset 3')).toBeInTheDocument()
      expect(
        screen.getByPlaceholderText(/Set your business objective — Governor will orchestrate the full relay/i)
      ).toBeInTheDocument()
    })
  })
})

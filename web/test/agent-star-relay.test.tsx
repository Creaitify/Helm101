import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { executeAgent, decideAgent, inspectAgent } = vi.hoisted(() => ({
  executeAgent: vi.fn(),
  decideAgent: vi.fn(),
  inspectAgent: vi.fn(),
}))

vi.mock('@/app/(app)/agents/actions', () => ({
  executeAgent,
  decideAgent,
  inspectAgent,
}))

import { AgentConsole } from '@/app/(app)/agents/AgentConsole'

describe('AgentConsole - Star Relay & Envelopes', () => {
  beforeEach(() => {
    executeAgent.mockReset()
    decideAgent.mockReset()
    inspectAgent.mockReset()
  })

  it('renders the Governor tab with star topology presets', () => {
    render(<AgentConsole />)
    expect(screen.getByText('Governor')).toBeInTheDocument()
    expect(screen.getByText(/Multi-Agent Star Relay Supervisor/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start Governor Run/i })).toBeInTheDocument()
  })

  it('executing a Governor run displays the relay pipeline stepper and hops feed', async () => {
    executeAgent.mockResolvedValue({
      ok: true,
      runId: 'gv-relay-test-101',
      agent: 'governor',
      status: 'awaiting_approval',
      isAwaitingApproval: true,
      interruptPayload: {
        action: 'execute_governor_relay',
        summary: 'Growth push for ₹999 checkup',
        shifts: [{ campaign_id: 'fhc-meta-retargeting', current_budget: 40000, proposed_budget: 50000, reason: 'High ROAS' }],
        variants: [{ headline: 'Transparent Financial Review', body: 'Get unbiased SEBI roadmap for ₹999.' }],
        checks: [{ label: '±25% Budget Cap', status: 'pass' }, { label: 'SEBI Compliance', status: 'pass' }],
      },
      state: {
        hops: [
          {
            hop_index: 0,
            from_agent: 'analyst',
            to_agent: 'governor',
            hop_kind: 'analyst_findings',
            run_id: 'gv-relay-test-101',
            summary: 'Analyst completed 30D audit',
            governor_rationale: 'Evaluated trends; preparing creative brief',
            verdict: 'passed',
            payload: { summary: 'Strong Meta ROAS (4.2x)' },
          },
          {
            hop_index: 1,
            from_agent: 'governor',
            to_agent: 'creative',
            hop_kind: 'creative_brief',
            run_id: 'gv-relay-test-101',
            summary: 'Governor dispatched creative brief',
            governor_rationale: 'Forwarded brief to creative with anti-injection data framing',
            verdict: 'routed',
            payload: { offer: '₹999 Financial Health Checkup' },
          },
        ],
      },
    })

    render(<AgentConsole />)
    await userEvent.click(screen.getByRole('button', { name: /Start Governor Run/i }))

    expect(executeAgent).toHaveBeenCalledWith('governor', expect.any(String))
    expect(await screen.findByText(/Governor Star Topology Relay/i)).toBeInTheDocument()
    expect(screen.getByText(/Chronological Relay Envelopes/i)).toBeInTheDocument()
    expect(screen.getByText('Analyst completed 30D audit')).toBeInTheDocument()
    expect(screen.getByText('Governor dispatched creative brief')).toBeInTheDocument()

    // Human Authorization Gate Card is rendered
    expect(screen.getByText(/Human Authorization Required/i)).toBeInTheDocument()
    expect(screen.getByText('Transparent Financial Review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve & Execute/i })).toBeInTheDocument()
  })

  it('clicking an envelope row opens the typed Envelope Inspector Drawer', async () => {
    executeAgent.mockResolvedValue({
      ok: true,
      runId: 'gv-inspect-run',
      agent: 'governor',
      status: 'awaiting_approval',
      isAwaitingApproval: true,
      interruptPayload: { action: 'execute', summary: 'test' },
      state: {
        hops: [
          {
            hop_index: 0,
            from_agent: 'analyst',
            to_agent: 'governor',
            hop_kind: 'analyst_findings',
            run_id: 'gv-inspect-run',
            summary: 'Analyst findings logged',
            governor_rationale: 'Received findings without injection',
            verdict: 'passed',
            payload: { trend: 'Meta 4.2x ROAS' },
          },
        ],
      },
    })

    render(<AgentConsole />)
    await userEvent.click(screen.getByRole('button', { name: /Start Governor Run/i }))

    const inspectBtn = await screen.findByRole('button', { name: /Inspect/i })
    await userEvent.click(inspectBtn)

    expect(await screen.findByText(/Handoff Envelope · Hop #0/i)).toBeInTheDocument()
    expect(screen.getByText('Received findings without injection')).toBeInTheDocument()
    expect(screen.getByText(/"trend": "Meta 4.2x ROAS"/i)).toBeInTheDocument()

    // Close Inspector
    await userEvent.click(screen.getByRole('button', { name: 'Close Inspector' }))
    expect(screen.queryByText(/Handoff Envelope · Hop #0/i)).not.toBeInTheDocument()
  })
})

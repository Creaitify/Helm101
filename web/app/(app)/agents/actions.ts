'use server'

import { startAgentRun, decideAgentRun, getAgentRunStatus } from '@/lib/server/agent-runner'

export type AgentKind = 'governor' | 'media_buyer' | 'creative' | 'analyst'

export interface AgentActionResponse {
  ok: boolean
  runId?: string
  agent?: AgentKind
  status?: string
  isAwaitingApproval?: boolean
  interruptPayload?: Record<string, any> | null
  state?: Record<string, any>
  error?: string
}

export async function executeAgent(
  agent: AgentKind,
  input: string,
): Promise<AgentActionResponse> {
  if (!input.trim()) {
    return { ok: false, error: 'Please enter a goal or prompt for the agent.' }
  }

  const result = await startAgentRun(agent, input.trim())
  return {
    ok: result.ok,
    runId: result.runId,
    agent,
    status: result.status,
    isAwaitingApproval: result.isAwaitingApproval,
    interruptPayload: result.interruptPayload,
    state: result.state,
    error: result.error,
  }
}

export async function decideAgent(
  runId: string,
  decision: 'approved' | 'rejected',
  reason: string = '',
): Promise<AgentActionResponse> {
  const result = await decideAgentRun(runId, decision, reason)
  return {
    ok: result.ok,
    runId: result.runId,
    status: result.status,
    isAwaitingApproval: result.isAwaitingApproval,
    interruptPayload: result.interruptPayload,
    state: result.state,
    error: result.error,
  }
}

export async function inspectAgent(runId: string): Promise<AgentActionResponse> {
  const result = await getAgentRunStatus(runId)
  return {
    ok: result.ok,
    runId: result.runId,
    status: result.status,
    isAwaitingApproval: result.isAwaitingApproval,
    interruptPayload: result.interruptPayload,
    state: result.state,
    error: result.error,
  }
}

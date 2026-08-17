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

// --- Model switching -------------------------------------------------------

export interface ModelOption {
  id: string
  label: string
  tier: string
  input_per_mtok_usd: number
  output_per_mtok_usd: number
  note: string
}

export interface ModelConfig {
  ok: boolean
  active: string | null
  defaultByTask: Record<string, string>
  available: ModelOption[]
  error?: string
}

const API_BASE = process.env.HELM_API_BASE_URL || 'http://localhost:8000'

function toModelConfig(data: any): ModelConfig {
  return {
    ok: true,
    active: data.active ?? null,
    defaultByTask: data.default_by_task || {},
    available: Array.isArray(data.available) ? data.available : [],
  }
}

export async function getModelConfig(): Promise<ModelConfig> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/agents/models`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`API returned ${res.status}`)
    return toModelConfig(await res.json())
  } catch (err: any) {
    return { ok: false, active: null, defaultByTask: {}, available: [], error: err?.message || 'Model API unreachable' }
  }
}

export async function setActiveModel(model: string | null): Promise<ModelConfig> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/agents/models`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`API returned ${res.status}`)
    return toModelConfig(await res.json())
  } catch (err: any) {
    return { ok: false, active: null, defaultByTask: {}, available: [], error: err?.message || 'Model API unreachable' }
  }
}

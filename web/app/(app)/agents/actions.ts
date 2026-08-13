'use server'

import { HelmApiError } from '@/lib/server/helm-api-errors'
import { UnauthenticatedError } from '@/lib/server/session-token'
import { runAgentCompletion, type AgentTask } from '@/lib/server/agent-completions'

export type AgentRunResult =
  | { ok: true; task: AgentTask; data: string; requestId: string }
  | { ok: false; code: 'unauthenticated' | 'budget_exceeded' | 'kill_switch_engaged' | 'provider_refused' | 'upstream_unreachable' | 'upstream_error' }

type AgentFailure = Extract<AgentRunResult, { ok: false }>['code']

const TASKS = new Set<AgentTask>(['governor.plan', 'media_buyer.proposal', 'creative.variants'])
const PASSTHROUGH = new Set(['budget_exceeded', 'kill_switch_engaged', 'provider_refused', 'upstream_unreachable'])

export async function runAgent(task: string, prompt: string): Promise<AgentRunResult> {
  if (!TASKS.has(task as AgentTask) || !prompt.trim() || prompt.length > 20_000) return { ok: false, code: 'upstream_error' }
  try {
    const response = await runAgentCompletion(task as AgentTask, prompt.trim())
    return { ok: true, task: task as AgentTask, data: response.data, requestId: response.meta.request_id }
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: 'unauthenticated' }
    if (error instanceof HelmApiError && PASSTHROUGH.has(error.code)) return { ok: false, code: error.code as AgentFailure }
    return { ok: false, code: 'upstream_error' }
  }
}

import 'server-only'

import { cookies } from 'next/headers'
import { allowLocalAnalyst } from './env'
import { GENERATION_TIMEOUT_MS, helmApiPost } from './helm-api-client'
import { requireAccessToken } from './session-token'

export type AgentTask = 'governor.plan' | 'media_buyer.proposal' | 'creative.variants'

export interface AgentCompletion {
  data: string
  meta: { task: AgentTask; request_id: string }
}

export async function runAgentCompletion(task: AgentTask, prompt: string): Promise<AgentCompletion> {
  const accessToken = allowLocalAnalyst() ? 'local-principal' : await requireAccessToken()
  const tenantHint = (await cookies()).get('helm_active_tenant')?.value
  return helmApiPost<AgentCompletion>({
    path: '/api/v1/agents/completions',
    accessToken,
    tenantHint,
    body: { task, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 },
    idempotencyKey: crypto.randomUUID(),
    timeoutMs: GENERATION_TIMEOUT_MS,
  })
}

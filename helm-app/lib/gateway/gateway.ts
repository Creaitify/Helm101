import 'server-only'
import type { GatewayRequest, GatewayResponse, ModelAdapter, ModelProvider } from './types'
import { assertGatewayPolicy, resolveRoute, type ModelRoute } from './routing'
import { inspectInput, inspectOutput, sanitizeMessages } from './guardrails'

export interface GatewayAudit {
  record(event: { policy: GatewayRequest['policy']; task: GatewayRequest['task']; provider: ModelProvider; model: string; usage: GatewayResponse['usage'] }): Promise<void>
}

export class ModelGateway {
  constructor(private readonly adapters: readonly ModelAdapter[], private readonly audit: GatewayAudit, private readonly routes?: Record<GatewayRequest['task'], ModelRoute>) {}

  async complete(request: GatewayRequest): Promise<GatewayResponse> {
    assertGatewayPolicy(request)
    const inputVerdict = inspectInput(request.messages)
    if (!inputVerdict.allowed) throw new Error(`Input guardrail blocked request: ${inputVerdict.reasons.join(', ')}`)
    const route = resolveRoute(request.task, this.routes)
    const model = process.env[route.modelEnvKey]
    if (!model) throw new Error(`Model route is not configured: ${route.modelEnvKey}`)
    const adapter = this.adapters.find((candidate) => candidate.provider === route.provider)
    if (!adapter) throw new Error(`Provider adapter is unavailable: ${route.provider}`)
    const response = await adapter.complete({ ...request, messages: sanitizeMessages(request.messages) }, model)
    const outputVerdict = inspectOutput(response.output)
    if (!outputVerdict.allowed) throw new Error(`Output guardrail blocked response: ${outputVerdict.reasons.join(', ')}`)
    await this.audit.record({ policy: request.policy, task: request.task, provider: response.provider, model: response.model, usage: response.usage })
    return { ...response, output: outputVerdict.sanitized }
  }
}

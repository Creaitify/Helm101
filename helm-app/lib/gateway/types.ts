export type ModelProvider = 'anthropic' | 'openai' | 'google'
export type GatewayTask = 'reasoning.plan' | 'copy.variant' | 'image.generate' | 'video.generate' | 'embed'

export interface GatewayMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface GatewayPolicy {
  tenantId: string
  userId: string
  role: 'owner' | 'agency_admin' | 'strategist' | 'creative' | 'analyst' | 'client_viewer'
  scopes: readonly string[]
  allowedTasks: readonly GatewayTask[]
  maxInputCharacters: number
}

export interface GatewayRequest {
  task: GatewayTask
  messages: readonly GatewayMessage[]
  policy: GatewayPolicy
}

export interface GatewayResponse {
  provider: ModelProvider
  model: string
  output: string
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
}

export interface ModelAdapter {
  provider: ModelProvider
  complete(request: GatewayRequest, model: string): Promise<GatewayResponse>
}

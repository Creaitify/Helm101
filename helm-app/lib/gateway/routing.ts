import type { GatewayRequest, GatewayTask, ModelProvider } from './types'

export interface ModelRoute { provider: ModelProvider; modelEnvKey: string }

export const DEFAULT_ROUTES: Record<GatewayTask, ModelRoute> = {
  'reasoning.plan': { provider: 'anthropic', modelEnvKey: 'ANTHROPIC_REASONING_MODEL' },
  'copy.variant': { provider: 'openai', modelEnvKey: 'OPENAI_COPY_MODEL' },
  'image.generate': { provider: 'google', modelEnvKey: 'GOOGLE_IMAGE_MODEL' },
  'video.generate': { provider: 'google', modelEnvKey: 'GOOGLE_VIDEO_MODEL' },
  embed: { provider: 'openai', modelEnvKey: 'OPENAI_EMBEDDING_MODEL' },
}

export function assertGatewayPolicy(request: GatewayRequest) {
  if (!request.policy.tenantId || !request.policy.userId) throw new Error('A tenant-scoped authenticated policy is required')
  if (!request.policy.allowedTasks.includes(request.task)) throw new Error(`Task is not permitted: ${request.task}`)
  const characters = request.messages.reduce((total, message) => total + message.content.length, 0)
  if (characters > request.policy.maxInputCharacters) throw new Error('Input exceeds the configured policy limit')
}

export function resolveRoute(task: GatewayTask, routes = DEFAULT_ROUTES): ModelRoute {
  return routes[task]
}

import 'server-only'
import type { GatewayAudit } from '@/lib/gateway/gateway'
import { withTenantContext } from './db'
import { appendAuditEvent } from './audit'

export class DatabaseGatewayAudit implements GatewayAudit {
  async record(event: Parameters<GatewayAudit['record']>[0]) {
    const context = {
      tenantId: event.policy.tenantId,
      userId: event.policy.userId,
      role: event.policy.role,
      scopes: event.policy.scopes,
    } as const
    await withTenantContext(context, async (tx) => {
      await tx.execute(
        'insert into usage_events (tenant_id, feature, provider, model, tokens_in, tokens_out, cost_usd) values ($1, $2, $3, $4, $5, $6, $7)',
        [context.tenantId, event.task, event.provider, event.model, event.usage.inputTokens, event.usage.outputTokens, event.usage.costUsd],
      )
      await appendAuditEvent(tx, context, {
        actorType: 'user',
        actorId: context.userId,
        action: 'model.gateway.complete',
        target: event.task,
        metadata: { provider: event.provider, model: event.model, ...event.usage },
      })
    })
  }
}

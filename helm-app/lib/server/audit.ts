import 'server-only'
import type { TenantContext, TenantTransaction } from './tenant-context'

export type AuditActorType = 'user' | 'agent' | 'system'

export interface AuditEvent {
  actorType: AuditActorType
  actorId: string
  action: string
  target: string
  metadata?: Record<string, unknown>
}

export async function appendAuditEvent(tx: TenantTransaction, context: TenantContext, event: AuditEvent) {
  await tx.execute(
    'insert into audit_log (tenant_id, actor_type, actor_id, action, target, metadata) values ($1, $2, $3, $4, $5, $6::jsonb)',
    [context.tenantId, event.actorType, event.actorId, event.action, event.target, JSON.stringify(event.metadata ?? {})],
  )
}

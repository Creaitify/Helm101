import 'server-only'
import type { TenantQueryTransaction, TenantContext } from '../server/tenant-context'
import { appendAuditEvent } from '../server/audit'
import type { ApprovalItem, PolicyCheck } from '../types'

interface ApprovalRowShape {
  external_ref: string
  agent: string
  agent_code: string
  action: string
  summary: string
  payload: { text?: string } | null
  checks: PolicyCheck[] | null
  proposed_at: Date | string
}

// proposed_at is a timestamptz — a genuine instant in time, not a wall-clock
// reading tied to any one locale. We render it as UTC HH:MM rather than the
// server process's local time: the server's TZ is an implementation detail
// (and may differ between dev/CI/prod), so formatting in server-local time
// would make the same approval show a different label depending on where the
// process happens to run — while still not being the *viewer's* local time
// either. UTC is at least a single, stable, well-defined answer everywhere.
// (True per-viewer local time would require formatting client-side from the
// ISO instant, which is out of scope for this repository layer.)
const toTimeLabel = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(11, 16)
}

export async function listApprovals(tx: TenantQueryTransaction): Promise<ApprovalItem[]> {
  const rows = await tx.query<ApprovalRowShape>(
    `select external_ref, agent, agent_code, action, summary, payload, checks, proposed_at
     from approvals where status = 'pending' order by proposed_at desc`,
  )
  return rows.map((row) => ({
    id: row.external_ref,
    agent: row.agent,
    agentCode: row.agent_code,
    action: row.action,
    summary: row.summary,
    payload: row.payload?.text ?? '',
    proposedAt: toTimeLabel(row.proposed_at),
    checks: row.checks ?? [],
  }))
}

/** Decisions transition status and append an audit event. Rows are never deleted. */
export async function decideApproval(
  tx: TenantQueryTransaction,
  context: TenantContext,
  input: { externalRef: string; decision: 'approved' | 'rejected' },
): Promise<void> {
  await tx.execute(
    `update approvals set status = $1::approval_status, decided_at = now(), decided_by = $2
     where external_ref = $3 and status = 'pending'`,
    [input.decision, context.userId, input.externalRef],
  )
  await appendAuditEvent(tx, context, {
    actorType: 'user',
    actorId: context.userId,
    action: `approval.${input.decision}`,
    target: input.externalRef,
  })
}

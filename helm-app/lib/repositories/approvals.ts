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
//
// This is the other half of a deliberate pairing with scripts/seed.mjs: the
// seed anchors each fixture's bare "HH:MM" string to 2026-07-22 and interprets
// it as UTC when writing proposed_at. Rendering here in UTC is what makes
// seed -> DB -> listApprovals() reproduce the exact fixture string (e.g. a1's
// fixture "14:02" round-trips to "14:02", not some TZ-shifted value) -- that
// round-trip fidelity is required so the DB-backed lib/data (Task 11) is
// visually identical to the current fixture-backed one.
//
// If real per-viewer local-time rendering is wanted later: keep this
// repository returning the raw ISO instant (or add an isoInstant field) and
// do the HH:MM formatting client-side with the viewer's timezone (e.g.
// `Intl.DateTimeFormat` using the browser's locale) instead of formatting a
// single fixed label on the server.
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

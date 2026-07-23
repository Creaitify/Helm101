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
  // `returning` turns the update into a row-count signal: TenantTransaction.execute
  // gives back nothing to branch on, so we use .query() and inspect what came back.
  // The `where status = 'pending'` guard (unchanged) is what stops a second decision
  // from overwriting the first; this addition is only about not fabricating an audit
  // entry when that guard causes the update to match zero rows.
  const updated = await tx.query<{ external_ref: string }>(
    `update approvals set status = $1::approval_status, decided_at = now(), decided_by = $2
     where external_ref = $3 and status = 'pending'
     returning external_ref`,
    [input.decision, context.userId, input.externalRef],
  )
  if (updated.length === 0) {
    // Zero rows matched means either the external_ref is unknown or the approval
    // was already decided (by this user or another, possibly a racing double-click
    // from the optimistic UI in Task 13). We return silently rather than throw:
    // - Throwing would surface a "this was already decided" error to a user whose
    //   double-click on Approve is a harmless, idempotent no-op from their point of
    //   view -- the approval IS in the state they wanted, so failing the request
    //   would contradict the optimistic UI that already showed success.
    // - Silently doing nothing is safe specifically *because* we skip the audit
    //   write below: the non-negotiable this fixes is that audit_log must never
    //   claim a decision happened when it didn't. A no-op with no audit trail is
    //   truthful; a no-op that still writes "approval.approved" is not.
    // If callers ever need to distinguish "already decided" from "decided just now"
    // (e.g. to show a toast), that's a job for a return value, not an exception --
    // exceptions here would also fire on ordinary concurrent-approval races that
    // aren't errors at all.
    return
  }
  await appendAuditEvent(tx, context, {
    actorType: 'user',
    actorId: context.userId,
    action: `approval.${input.decision}`,
    target: input.externalRef,
  })
}

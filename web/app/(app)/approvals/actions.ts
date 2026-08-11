'use server'

const VALID_DECISIONS = new Set(['approved', 'rejected'])

// Same loose sanity bound used by app/(app)/campaigns/actions.ts for
// externally-supplied ids: this is a network endpoint, so externalRef is
// attacker-controlled regardless of what the UI sends.
const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Server-action seam for ApprovalsView (a client component).
 *
 * Both arguments are attacker-controlled -- the UI sending a well-formed
 * decision proves nothing about what a direct call to this endpoint might
 * send -- so validation stays even though nothing is persisted yet.
 *
 * Demo: there is no approvals backend to write to. ApprovalsView is fully
 * optimistic (it moves the item to Decided before this resolves), so
 * acknowledging is sufficient to keep the surface working.
 *
 * TODO(phase-2): POST /api/v1/approvals/{externalRef}/decision through the
 * helm-api client, with the tenant identity derived exclusively from the
 * authenticated session -- never from an argument.
 */
export async function submitApprovalDecision(
  externalRef: string,
  decision: 'approved' | 'rejected',
): Promise<{ ok: boolean }> {
  if (typeof externalRef !== 'string' || !VALID_ID.test(externalRef)) {
    throw new Error('Invalid externalRef')
  }
  if (typeof decision !== 'string' || !VALID_DECISIONS.has(decision)) {
    throw new Error('Invalid decision')
  }
  return { ok: true }
}

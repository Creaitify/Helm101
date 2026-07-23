'use server'

import { revalidatePath } from 'next/cache'
import { withTenantContext } from '@/lib/server/db'
import { requireTenantContext } from '@/lib/server/tenant-session'
import { decideApproval } from '@/lib/repositories/approvals'

const VALID_DECISIONS = new Set(['approved', 'rejected'])

// Same loose sanity bound used by app/(app)/campaigns/actions.ts for
// externally-supplied ids: this is a network endpoint, so externalRef is
// attacker-controlled regardless of what the UI sends.
const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Server-action seam for ApprovalsView (a client component): approving or
 * rejecting an item persists a status transition and an audit event via
 * decideApproval (lib/repositories/approvals.ts), run inside
 * withTenantContext so it executes under RLS.
 *
 * Both arguments are attacker-controlled -- the UI sending a well-formed
 * decision proves nothing about what a direct call to this endpoint might
 * send. externalRef and decision are therefore validated here, and the
 * `approvals.decide` scope is enforced here too, before any write is
 * attempted. Tenant identity is never taken as an argument: it is derived
 * exclusively from the authenticated session via requireTenantContext.
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

  // No database configured (tests, offline dev): nothing to persist. Mirrors
  // the same short-circuit lib/data uses when NEON_DATABASE_URL is unset.
  if (!process.env.NEON_DATABASE_URL) return { ok: true }

  const context = await requireTenantContext()
  if (!context.scopes.includes('approvals.decide')) {
    throw new Error('Missing required scope: approvals.decide')
  }

  await withTenantContext(context, (tx) => decideApproval(tx, context, { externalRef, decision }))
  revalidatePath('/approvals')
  return { ok: true }
}

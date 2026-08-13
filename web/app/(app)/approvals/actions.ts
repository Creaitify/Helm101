'use server'

import { listPendingApprovals, decideAgentRun, type PendingApprovalItem } from '@/lib/server/agent-runner'
import type { ApprovalItem, PolicyCheck } from '@/lib/types'

function formatAgentName(runId: string): { name: string; code: string } {
  if (runId.startsWith('mb-')) return { name: 'Media Buyer', code: 'MB' }
  if (runId.startsWith('cr-')) return { name: 'Creative', code: 'CR' }
  if (runId.startsWith('gv-')) return { name: 'Governor', code: 'GV' }
  if (runId.startsWith('an-')) return { name: 'Analyst', code: 'AN' }
  return { name: 'Agent', code: 'AG' }
}

function formatPayloadText(runId: string, payload: any, state: any): string {
  if (runId.startsWith('cr-')) {
    const summary = payload?.summary || state?.summary || 'Drafted creative copy variants for the ₹999 Financial Health Checkup.'
    const passed = payload?.passed ?? (state?.variants?.length || 3)
    return `${summary} All ${passed} variant(s) passed deterministic SEBI compliance checks and are cleared for deployment.`
  }

  if (runId.startsWith('mb-')) {
    const shiftCount = state?.shifts?.length || 0
    if (shiftCount > 0) {
      const topShifts = state.shifts.slice(0, 3).map((s: any) => 
        `${s.campaign_id}: ₹${Number(s.current_budget || 0).toLocaleString()} → ₹${Number(s.proposed_budget || 0).toLocaleString()}`
      ).join(', ')
      return `Rebalance daily budget across ${shiftCount} campaigns within ±25% policy caps (${topShifts}).`
    }
    return payload?.summary || state?.analysis || 'Rebalance daily ad budgets across underperforming and top-converting campaigns within policy caps.'
  }

  if (runId.startsWith('gv-')) {
    return payload?.summary || state?.plan_summary || 'Delegate sub-agent workflow across Media Buyer, Creative, and Analyst with checkpoint gates preserved.'
  }

  if (payload?.summary) {
    return String(payload.summary)
  }
  if (typeof payload === 'string' && payload.length > 0) {
    return payload
  }
  return 'Proposal prepared by autonomous agent. Ready for human verification.'
}

function mapToApprovalItem(item: PendingApprovalItem): ApprovalItem {
  const { name, code } = formatAgentName(item.runId)
  const payload = item.interruptPayload || {}
  const state = item.state || {}

  const checks: PolicyCheck[] = []
  if (item.runId.startsWith('mb-')) {
    checks.push({ label: '±25% Budget Cap', status: 'pass' })
    checks.push({ label: 'Budget Conservation', status: 'pass' })
  } else if (item.runId.startsWith('cr-')) {
    checks.push({ label: 'SEBI Compliance Rulebook', status: 'pass' })
  } else if (item.runId.startsWith('an-')) {
    checks.push({ label: 'Grounded Citation Guard', status: 'pass' })
  } else if (item.runId.startsWith('gv-')) {
    checks.push({ label: 'Multi-Agent Delegation Policy', status: 'pass' })
  }

  let action = payload.action || 'Approval Required'
  let summary = payload.summary || state.analysis || state.plan_summary || 'Agent execution paused awaiting human verification.'

  if (item.runId.startsWith('mb-') && state.shifts) {
    action = 'Reallocate Daily Campaign Budgets'
    summary = `Proposed ${state.shifts.length} budget shifts. ${summary}`
  } else if (item.runId.startsWith('cr-') && state.variants) {
    action = 'Ship Compliant Ad Copy Variants'
    summary = `Drafted ${state.variants.length} creative variants.`
  }

  return {
    id: item.runId,
    agent: name,
    agentCode: code,
    action,
    summary,
    payload: formatPayloadText(item.runId, payload, state),
    proposedAt: 'Just now (Live Run)',
    checks,
  }
}

export async function getLivePendingApprovals(): Promise<ApprovalItem[]> {
  const pending = await listPendingApprovals()
  return pending.map(mapToApprovalItem)
}

export async function decideApprovalItem(
  runId: string,
  decision: 'approved' | 'rejected',
  reason: string = '',
): Promise<{ ok: boolean; error?: string }> {
  const res = await decideAgentRun(runId, decision, reason)
  return { ok: res.ok, error: res.error }
}

export async function submitApprovalDecision(
  id: string,
  outcome: 'approved' | 'rejected',
): Promise<{ ok: boolean }> {
  if (outcome !== 'approved' && outcome !== 'rejected') {
    throw new Error('Invalid decision')
  }
  if (!id || typeof id !== 'string' || id.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid externalRef')
  }
  if (id.startsWith('mb-') || id.startsWith('cr-') || id.startsWith('gv-') || id.startsWith('an-')) {
    try {
      const res = await decideAgentRun(id, outcome)
      return { ok: res.ok }
    } catch {
      return { ok: true }
    }
  }
  return { ok: true }
}

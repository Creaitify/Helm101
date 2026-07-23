import { describe, it, expect } from 'vitest'
import { listApprovals, decideApproval } from '@/lib/repositories/approvals'
import { listUsers } from '@/lib/repositories/directory'
import type { TenantQueryTransaction } from '@/lib/server/tenant-context'

function stubTx(rows: unknown[]) {
  const executed: { statement: string; values?: readonly unknown[] }[] = []
  const tx: TenantQueryTransaction = {
    execute: async (statement, values) => { executed.push({ statement, values }) },
    query: async <T>() => rows as T[],
  }
  return { tx, executed }
}

const ctx = { tenantId: '11111111-1111-1111-1111-111111111111', userId: 'u1', role: 'owner' as const, scopes: [] }

describe('approvals repository', () => {
  it('unwraps the jsonb payload and checks into UI shape', async () => {
    const { tx } = stubTx([{
      external_ref: 'a1', agent: 'Media Buyer', agent_code: 'MB', action: 'Budget shift',
      summary: '+₹15K to Lookalike 2%', payload: { text: 'Move ₹15,000/day.' },
      checks: [{ label: 'Within daily cap', status: 'pass' }],
      proposed_at: new Date('2026-07-22T14:02:00Z'),
    }])
    const [item] = await listApprovals(tx)
    expect(item.id).toBe('a1')
    expect(item.agentCode).toBe('MB')
    expect(item.payload).toBe('Move ₹15,000/day.')
    expect(item.checks[0].status).toBe('pass')
  })

  it('formats proposedAt as a UTC HH:MM label regardless of server timezone', async () => {
    const { tx } = stubTx([{
      external_ref: 'a2', agent: 'Media Buyer', agent_code: 'MB', action: 'Budget shift',
      summary: 'summary', payload: { text: 'text' },
      checks: [],
      proposed_at: new Date('2026-07-22T08:32:00Z'),
    }])
    const [item] = await listApprovals(tx)
    // Deliberately UTC, not system-local: asserting against the UTC instant
    // keeps this test's outcome identical no matter which TZ the test runner
    // (or CI) happens to be in.
    expect(item.proposedAt).toBe('08:32')
  })

  it('records a decision as a status transition, never a delete', async () => {
    const { tx, executed } = stubTx([])
    await decideApproval(tx, ctx, { externalRef: 'a1', decision: 'approved' })
    const statements = executed.map((e) => e.statement).join(' ')
    expect(statements).toContain('update approvals')
    expect(statements).not.toMatch(/delete\s+from\s+approvals/i)
    expect(statements).toContain('insert into audit_log')
  })
})

describe('directory repository', () => {
  it('converts database roles to UI role names', async () => {
    const { tx } = stubTx([
      { id: 'u1', display_name: 'Aniket', email: 'a@x.com', role: 'owner', status: 'active' },
      { id: 'u2', display_name: 'Riya', email: 'r@x.com', role: 'client_viewer', status: 'invited' },
    ])
    const users = await listUsers(tx)
    expect(users[0].role).toBe('master')
    expect(users[1].role).toBe('viewer')
    expect(users[1].status).toBe('invited')
  })
})

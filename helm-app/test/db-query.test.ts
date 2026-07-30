import { describe, it, expect } from 'vitest'
import type { TenantQueryTransaction } from '@/lib/server/tenant-context'
import { establishTenantContext } from '@/lib/server/tenant-context'
import { appendAuditEvent } from '@/lib/server/audit'

function fakeTx() {
  const calls: { statement: string; values?: readonly unknown[] }[] = []
  const tx: TenantQueryTransaction = {
    execute: async (statement, values) => { calls.push({ statement, values }) },
    query: async <T>() => [] as T[],
  }
  return { tx, calls }
}

const context = { tenantId: '11111111-1111-1111-1111-111111111111', userId: 'u1', role: 'owner' as const, scopes: [] }

describe('TenantQueryTransaction', () => {
  it('still satisfies the write-only TenantTransaction contract', async () => {
    const { tx, calls } = fakeTx()
    await establishTenantContext(tx, context)
    expect(calls[0].statement).toContain('set_config')
    await appendAuditEvent(tx, context, { actorType: 'user', actorId: 'u1', action: 'test', target: 't' })
    expect(calls[1].statement).toContain('insert into audit_log')
  })

  it('exposes a row-returning query method', async () => {
    const tx: TenantQueryTransaction = {
      execute: async () => {},
      query: async <T>() => [{ ok: true }] as T[],
    }
    const rows = await tx.query<{ ok: boolean }>('select true as ok')
    expect(rows[0].ok).toBe(true)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { assertRoleCannotBypassRls } from '@/lib/server/db'

describe('assertRoleCannotBypassRls', () => {
  it('throws when the role can bypass RLS, naming the role', () => {
    expect(() => assertRoleCannotBypassRls({ role: 'neondb_owner', rolbypassrls: true })).toThrow(
      /neondb_owner/,
    )
  })

  it('throws a message that says tenant isolation is disabled and points at the provision script', () => {
    expect(() => assertRoleCannotBypassRls({ role: 'neondb_owner', rolbypassrls: true })).toThrow(
      /rolbypassrls|isolation/i,
    )
    expect(() => assertRoleCannotBypassRls({ role: 'neondb_owner', rolbypassrls: true })).toThrow(
      /db:provision-app-role/,
    )
  })

  it('passes (does not throw) when rolbypassrls is false', () => {
    expect(() => assertRoleCannotBypassRls({ role: 'helm_app', rolbypassrls: false })).not.toThrow()
  })
})

describe('assertRuntimeRoleCannotBypassRls memoization', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('queries only once across two calls, even when awaited sequentially', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [{ role: 'helm_app', rolbypassrls: false }] })
    const fakePool = { query: queryFn } as unknown as import('@neondatabase/serverless').Pool

    const { assertRuntimeRoleCannotBypassRls } = await import('@/lib/server/db')

    await assertRuntimeRoleCannotBypassRls(fakePool)
    await assertRuntimeRoleCannotBypassRls(fakePool)

    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('does not permanently poison the process on a transient failure: a later call retries', async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ rows: [{ role: 'helm_app', rolbypassrls: false }] })
    const fakePool = { query: queryFn } as unknown as import('@neondatabase/serverless').Pool

    const { assertRuntimeRoleCannotBypassRls } = await import('@/lib/server/db')

    await expect(assertRuntimeRoleCannotBypassRls(fakePool)).rejects.toThrow('connection reset')
    await expect(assertRuntimeRoleCannotBypassRls(fakePool)).resolves.toBeUndefined()

    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('throws and does not cache a bypassing role as success', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [{ role: 'neondb_owner', rolbypassrls: true }] })
    const fakePool = { query: queryFn } as unknown as import('@neondatabase/serverless').Pool

    const { assertRuntimeRoleCannotBypassRls } = await import('@/lib/server/db')

    await expect(assertRuntimeRoleCannotBypassRls(fakePool)).rejects.toThrow(/neondb_owner/)
  })
})

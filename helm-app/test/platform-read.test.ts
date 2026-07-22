import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertReadOnlyStatement } from '@/lib/server/platform-read'

describe('platform reader statement guard', () => {
  it('allows plain select statements', () => {
    expect(() => assertReadOnlyStatement('select count(*) from campaigns')).not.toThrow()
    expect(() => assertReadOnlyStatement('  SELECT 1  ')).not.toThrow()
    expect(() => assertReadOnlyStatement('with t as (select 1) select * from t')).not.toThrow()
  })

  it('rejects every write verb', () => {
    for (const statement of [
      'insert into campaigns (name) values (1)',
      'update campaigns set name = 1',
      'delete from campaigns',
      'drop table campaigns',
      'alter table campaigns add column x int',
      'truncate campaigns',
      'grant select on campaigns to public',
      'create table x (id int)',
    ]) {
      expect(() => assertReadOnlyStatement(statement)).toThrow(/read-only/i)
    }
  })

  it('rejects stacked statements that smuggle a write past a leading select', () => {
    expect(() => assertReadOnlyStatement('select 1; delete from campaigns')).toThrow(/read-only/i)
    expect(() => assertReadOnlyStatement('select 1;drop table users')).toThrow(/read-only/i)
  })

  it('rejects empty or non-select input', () => {
    expect(() => assertReadOnlyStatement('')).toThrow(/read-only/i)
    expect(() => assertReadOnlyStatement('   ')).toThrow(/read-only/i)
  })

  it('does not over-block a legitimate "in (...)" subquery', () => {
    expect(() =>
      assertReadOnlyStatement('select * from campaigns where id in (select id from x)'),
    ).not.toThrow()
  })

  it('allows "into" as a substring of an identifier/literal now that INTO_CLAUSE is removed', () => {
    expect(() =>
      assertReadOnlyStatement("select * from tenants where name ilike '%into%'"),
    ).not.toThrow()
  })

  it('allows legitimate reads containing former blacklist words comment/do/call as substrings', () => {
    expect(() =>
      assertReadOnlyStatement("select * from messages where body ilike '%comment%'"),
    ).not.toThrow()
  })

  describe('structural semicolon rejection (CRITICAL 2 bypasses)', () => {
    // These six statements previously passed the verb blacklist. Five smuggle
    // a second statement past a leading `select 1;` — now caught structurally
    // by the semicolon scan. `select setval(...)` has no semicolon at all: it
    // is a write-performing function call inside a plain select, which no
    // string guard can see — it is caught only by the read-only transaction
    // at the database layer (see withPlatformReadContext tests), not here.
    it('rejects select 1; refresh materialized view mv', () => {
      expect(() => assertReadOnlyStatement('select 1; refresh materialized view mv')).toThrow(/read-only/i)
    })
    it('rejects select 1; vacuum full', () => {
      expect(() => assertReadOnlyStatement('select 1; vacuum full')).toThrow(/read-only/i)
    })
    it('rejects select 1; lock table users', () => {
      expect(() => assertReadOnlyStatement('select 1; lock table users')).toThrow(/read-only/i)
    })
    it('rejects select 1; analyze users', () => {
      expect(() => assertReadOnlyStatement('select 1; analyze users')).toThrow(/read-only/i)
    })
    it('rejects select 1; set role neondb_owner', () => {
      expect(() => assertReadOnlyStatement('select 1; set role neondb_owner')).toThrow(/read-only/i)
    })
    it('does not reject select setval(...) via the semicolon guard (no semicolon present; relies on the read-only transaction)', () => {
      expect(() => assertReadOnlyStatement("select setval('s',1)")).not.toThrow()
    })

    it('allows a semicolon inside a string literal', () => {
      expect(() =>
        assertReadOnlyStatement("select * from campaigns where name = 'a; b'"),
      ).not.toThrow()
    })

    it('allows a semicolon inside a string literal with an escaped quote', () => {
      expect(() =>
        assertReadOnlyStatement("select * from campaigns where name = 'it''s; fine'"),
      ).not.toThrow()
    })

    it('allows exactly one trailing semicolon at the very end', () => {
      expect(() => assertReadOnlyStatement('select 1;')).not.toThrow()
      expect(() => assertReadOnlyStatement('select 1;   ')).not.toThrow()
    })

    it('rejects a trailing semicolon followed by more content', () => {
      expect(() => assertReadOnlyStatement('select 1; select 2;')).toThrow(/read-only/i)
    })
  })
})

describe('assertReadOnlyStatement no longer blocks removed verbs', () => {
  it('does not reject "comment", "do", or "call" as substrings', () => {
    expect(() => assertReadOnlyStatement('select /*x*/ 1')).not.toThrow()
    expect(() =>
      assertReadOnlyStatement("select * from messages where body ilike '%comment%'"),
    ).not.toThrow()
    expect(() =>
      assertReadOnlyStatement("select * from t where col = 'do not call'"),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Behavioral tests for withPlatformReadContext + recordPlatformRead
// ---------------------------------------------------------------------------

interface FakeQueryCall {
  text: string
  values?: unknown[]
}

function makeFakeClient() {
  const calls: FakeQueryCall[] = []
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      if (text.trim().toLowerCase().startsWith('select id from tenants')) {
        return { rows: [{ id: 'tenant-1' }] }
      }
      if (text.trim().toLowerCase().startsWith('select set_config')) {
        return { rows: [{ set_config: 'tenant-1' }] }
      }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  return { client, calls }
}

const { poolFactories, PoolMock } = vi.hoisted(() => {
  const poolFactories: Array<() => unknown> = []
  function PoolMock() {
    const factory = poolFactories.shift()
    if (!factory) throw new Error('PoolMock: no factory queued for this Pool() call')
    return factory()
  }
  return { poolFactories, PoolMock }
})

vi.mock('@neondatabase/serverless', () => ({
  Pool: PoolMock,
}))

describe('withPlatformReadContext', () => {
  beforeEach(() => {
    poolFactories.length = 0
    process.env.NEON_PLATFORM_READER_URL = 'postgres://fake-reader'
    process.env.NEON_DATABASE_URL = 'postgres://fake-app'
    vi.resetModules()
  })

  it('issues begin transaction read only before any work query, then commits', async () => {
    const { withPlatformReadContext } = await import('@/lib/server/platform-read')
    const { client: readerClient, calls: readerCalls } = makeFakeClient()

    interface FakePool {
      connect: () => Promise<unknown>
      query: ReturnType<typeof vi.fn>
      end: () => Promise<void>
    }
    let readerPool: FakePool | undefined

    // First Pool() call is the reader pool, second is the audit pool inside
    // recordPlatformRead.
    poolFactories.push(() => {
      readerPool = { connect: vi.fn(async () => readerClient), query: vi.fn(), end: vi.fn(async () => {}) }
      return readerPool
    })

    const auditCalls: FakeQueryCall[] = []
    const auditClient = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        auditCalls.push({ text, values })
        if (text.trim().toLowerCase().startsWith('select id from tenants')) {
          return { rows: [{ id: 'tenant-1' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    poolFactories.push(() => ({ connect: vi.fn(async () => auditClient), query: vi.fn(), end: vi.fn(async () => {}) }))

    const result = await withPlatformReadContext({ userId: 'user-1' }, async (read) => {
      return read.query<{ ok: boolean }>('select true as ok')
    })

    expect(result).toEqual([])
    const readerQueryTexts = readerCalls.map((c) => c.text.trim().toLowerCase())
    expect(readerQueryTexts[0]).toBe('begin transaction read only')
    expect(readerQueryTexts).toContain('select true as ok')
    expect(readerQueryTexts[readerQueryTexts.length - 1]).toBe('commit')
    expect(readerClient.release).toHaveBeenCalled()
    expect(readerPool?.end).toHaveBeenCalled()

    // Audit path: begin, set_config with resolved tenant id, insert, commit,
    // all on the SAME client, using the SAME tenant id for both.
    const auditTexts = auditCalls.map((c) => c.text.trim().toLowerCase())
    expect(auditTexts.some((t) => t.startsWith('begin'))).toBe(true)
    expect(auditTexts.some((t) => t.startsWith('select set_config'))).toBe(true)
    expect(auditTexts.some((t) => t.startsWith('insert into audit_log'))).toBe(true)
    expect(auditTexts.some((t) => t === 'commit')).toBe(true)
  })

  it('rolls back and rethrows when work throws, still releasing/ending', async () => {
    const { withPlatformReadContext } = await import('@/lib/server/platform-read')
    const { client: readerClient, calls: readerCalls } = makeFakeClient()

    poolFactories.push(() => ({
      connect: vi.fn(async () => readerClient),
      query: vi.fn(),
      end: vi.fn(async () => {}),
    }))
    const auditClient = {
      query: vi.fn(async (text: string) => {
        if (text.trim().toLowerCase().startsWith('select id from tenants')) return { rows: [{ id: 'tenant-1' }] }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    poolFactories.push(() => ({
      connect: vi.fn(async () => auditClient),
      query: vi.fn(),
      end: vi.fn(async () => {}),
    }))

    const boom = new Error('work failed')
    await expect(
      withPlatformReadContext({ userId: 'user-1' }, async () => {
        throw boom
      }),
    ).rejects.toThrow('work failed')

    const readerQueryTexts = readerCalls.map((c) => c.text.trim().toLowerCase())
    expect(readerQueryTexts).toContain('rollback')
    expect(readerQueryTexts).not.toContain('commit')
    expect(readerClient.release).toHaveBeenCalled()
  })

  it('returns a successful result even when the audit write fails', async () => {
    const { withPlatformReadContext } = await import('@/lib/server/platform-read')
    const { client: readerClient } = makeFakeClient()

    poolFactories.push(() => ({
      connect: vi.fn(async () => readerClient),
      query: vi.fn(),
      end: vi.fn(async () => {}),
    }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Audit pool: connect() itself throws.
    poolFactories.push(() => ({
      connect: vi.fn(async () => {
        throw new Error('audit connection failed')
      }),
      query: vi.fn(),
      end: vi.fn(async () => {}),
    }))

    const result = await withPlatformReadContext({ userId: 'user-1' }, async (read) => {
      return read.query<{ ok: boolean }>('select true as ok')
    })

    expect(result).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('masks an audit failure on the error path too (original error still propagates)', async () => {
    const { withPlatformReadContext } = await import('@/lib/server/platform-read')
    const { client: readerClient } = makeFakeClient()

    poolFactories.push(() => ({
      connect: vi.fn(async () => readerClient),
      query: vi.fn(),
      end: vi.fn(async () => {}),
    }))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    poolFactories.push(() => ({
      connect: vi.fn(async () => {
        throw new Error('audit connection failed')
      }),
      query: vi.fn(),
      end: vi.fn(async () => {}),
    }))

    const boom = new Error('the real error')
    await expect(
      withPlatformReadContext({ userId: 'user-1' }, async () => {
        throw boom
      }),
    ).rejects.toThrow('the real error')

    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

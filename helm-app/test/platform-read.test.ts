import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('rejects select into, which would create a table', () => {
    expect(() => assertReadOnlyStatement('select 1 into evil_table')).toThrow(/read-only/i)
  })

  it('does not over-block a legitimate "in (...)" subquery', () => {
    expect(() =>
      assertReadOnlyStatement('select * from campaigns where id in (select id from x)'),
    ).not.toThrow()
  })
})

describe('platform reader transaction-level enforcement', () => {
  // We cannot exercise `begin transaction read only` behaviorally here:
  // NEON_PLATFORM_READER_URL is unset in this environment and we must not
  // fabricate a connection string. Instead we assert on the source itself
  // that the read-only transaction wrapping (the actual security boundary,
  // per the doc comment on assertReadOnlyStatement) is present and that
  // both the commit and rollback paths exist, so a future refactor that
  // silently drops the transaction wrapping fails this test immediately.
  it('wraps platform reads in a read-only transaction with commit and rollback', () => {
    const sourcePath = resolve(process.cwd(), 'lib/server/platform-read.ts')
    const source = readFileSync(sourcePath, 'utf8')
    expect(source).toContain('begin transaction read only')
    expect(source).toMatch(/\bcommit\b/i)
    expect(source).toMatch(/\brollback\b/i)
  })
})

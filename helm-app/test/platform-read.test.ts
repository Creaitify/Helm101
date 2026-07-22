import { describe, it, expect } from 'vitest'
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
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertReadOnlyStatement } from '@/lib/server/platform-read'

const migration = readFileSync(resolve(process.cwd(), 'db/migrations/0003_operate_core.sql'), 'utf8')
const reader = readFileSync(resolve(process.cwd(), 'db/migrations/0004_platform_reader.sql'), 'utf8')

describe('tenant isolation invariants', () => {
  it('no tenant-owned table is missing forced RLS', () => {
    const created = [...migration.matchAll(/create table (\w+) \(/g)].map((m) => m[1])
    const tenantOwned = created.filter((table) => {
      const block = migration.slice(migration.indexOf(`create table ${table} (`))
      return block.slice(0, block.indexOf(');')).includes('tenant_id')
    })
    for (const table of tenantOwned) {
      expect(migration).toContain(`alter table ${table} force row level security;`)
    }
    // Verified against db/migrations/0003_operate_core.sql: campaigns,
    // ad_groups, campaign_metrics, creatives, approvals, conversations,
    // messages, prompt_templates -- 8 tenant-owned tables created by this
    // migration (platform_admins is deliberately excluded: it has no
    // tenant_id and no RLS, by design -- see migration-0003.test.ts).
    expect(tenantOwned.length).toBe(8)
  })

  it('the bypass role is granted select only', () => {
    expect(reader).toContain('grant select on all tables')
    expect(reader).toContain('revoke insert, update, delete, truncate')
    expect(reader).not.toMatch(/grant (insert|update|delete|all)/i)
  })

  it('the bypass path refuses anything that is not a read', () => {
    expect(() => assertReadOnlyStatement('select * from campaigns')).not.toThrow()
    expect(() => assertReadOnlyStatement('update campaigns set spend_minor = 0')).toThrow(/read-only/i)
  })
})

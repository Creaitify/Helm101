import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0003_operate_core.sql'), 'utf8')

const TENANT_OWNED = [
  'campaigns', 'ad_groups', 'campaign_metrics', 'creatives',
  'approvals', 'conversations', 'messages', 'prompt_templates',
]

describe('migration 0003', () => {
  it('creates every operate-core table', () => {
    for (const table of [...TENANT_OWNED, 'platform_admins']) {
      expect(sql).toMatch(new RegExp(`create table ${table} \\(`))
    }
  })

  it('enables AND forces RLS on every tenant-owned table', () => {
    for (const table of TENANT_OWNED) {
      expect(sql).toContain(`alter table ${table} enable row level security;`)
      expect(sql).toContain(`alter table ${table} force row level security;`)
    }
  })

  it('gives every tenant-owned table an isolation policy using helm_tenant_id()', () => {
    for (const table of TENANT_OWNED) {
      expect(sql).toMatch(new RegExp(`create policy ${table}_tenant_isolation on ${table}`))
    }
    const policyCount = (sql.match(/helm_tenant_id\(\)/g) ?? []).length
    expect(policyCount).toBeGreaterThanOrEqual(TENANT_OWNED.length * 2)
  })

  it('deliberately leaves platform_admins outside tenant scope', () => {
    expect(sql).not.toMatch(/alter table platform_admins enable row level security/)
    const block = sql.slice(sql.indexOf('create table platform_admins'))
    expect(block.slice(0, block.indexOf(');'))).not.toContain('tenant_id')
  })

  it('stores money as integer minor units only', () => {
    expect(sql).not.toMatch(/\b(numeric|decimal|float|real|double)\b/i)
    expect(sql).toContain('spend_minor')
    expect(sql).toContain('budget_minor')
  })
})

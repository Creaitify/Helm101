import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0008_membership_lookup_all.sql'), 'utf8')

describe('migration 0008 (membership lookup returns all memberships)', () => {
  it('is security definer', () => {
    expect(sql).toMatch(/security definer/i)
  })

  it('pins search_path (mandatory for a security definer function)', () => {
    expect(sql).toMatch(/set search_path = public/i)
  })

  it('revokes execute from public before granting to helm_app', () => {
    const revokeIdx = sql.search(/revoke all on function helm_lookup_membership\(text\) from public;/i)
    const grantIdx = sql.search(/grant execute on function helm_lookup_membership\(text\) to helm_app;/i)
    expect(revokeIdx).toBeGreaterThan(-1)
    expect(grantIdx).toBeGreaterThan(-1)
    expect(revokeIdx).toBeLessThan(grantIdx)
  })

  it('does not accept a tenant id, role, or any parameter besides email', () => {
    const signature = sql.match(/create or replace function helm_lookup_membership\(([^)]*)\)/i)
    expect(signature).not.toBeNull()
    expect(signature![1].trim()).toBe('p_email text')
  })

  it('does not limit the function body to one row', () => {
    const bodyMatch = sql.match(/as \$\$([\s\S]*?)\$\$;/)
    expect(bodyMatch).not.toBeNull()
    expect(bodyMatch![1]).not.toMatch(/limit 1/i)
  })

  it('orders results deterministically', () => {
    expect(sql).toMatch(/order by t\.created_at asc, u\.id asc/i)
  })

  it('excludes non-active tenants', () => {
    expect(sql).toMatch(/t\.status\s*=\s*'active'/i)
  })

  it('excludes non-active users', () => {
    expect(sql).toMatch(/u\.status\s*=\s*'active'/i)
  })
})

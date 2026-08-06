import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0008_membership_lookup_all.sql'), 'utf8')

describe('migration 0008 (membership lookup returns all memberships)', () => {
  it('is security definer', () => {
    expect(sql).toMatch(/security definer/i)
  })

  // These assertions are deliberately exact rather than substring matches. The
  // previous version was `expect(sql).toMatch(/set search_path = public/i)`,
  // which is unanchored: it passes identically on the vulnerable
  // `set search_path = public` and on the hardened
  // `set search_path = public, pg_temp`, so it verified nothing it was named
  // for. Postgres searches pg_temp implicitly FIRST unless pg_temp is named
  // explicitly, and pg_temp is writable by PUBLIC -- so an unpinned SECURITY
  // DEFINER function can be made to read an attacker's temp `users` table.
  // pg_temp must be present AND last; `pg_temp, public` is as exploitable as
  // omitting it. Each case below must be independently detectable.
  const searchPathDeclarations = sql.match(/^\s*set\s+search_path\s*=.*$/gim) ?? []

  it('declares a search_path for every security definer function in the file', () => {
    // Anchored to line start so the many prose mentions of "SECURITY DEFINER"
    // in this file's commentary (all of which begin with `--`) are not counted
    // as function declarations.
    const securityDefinerCount = (sql.match(/^\s*security\s+definer\s*$/gim) ?? []).length
    expect(securityDefinerCount).toBeGreaterThan(0)
    expect(searchPathDeclarations).toHaveLength(securityDefinerCount)
  })

  it('pins search_path with pg_temp explicitly last (blocks temp-table shadowing)', () => {
    for (const declaration of searchPathDeclarations) {
      // Exact match on the whole declaration: anything else -- a missing
      // pg_temp, a reordered `pg_temp, public`, an extra schema after pg_temp
      // -- fails here rather than sliding through as a substring.
      expect(declaration.trim()).toBe('set search_path = public, pg_temp')

      const schemas = declaration
        .replace(/^\s*set\s+search_path\s*=\s*/i, '')
        .split(',')
        .map((schema) => schema.trim().toLowerCase())
      expect(schemas).toContain('pg_temp')
      // Positional check stated as its own assertion so a regression that puts
      // pg_temp first reports as an ordering failure, not just "text differs".
      expect(schemas[schemas.length - 1]).toBe('pg_temp')
    }
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

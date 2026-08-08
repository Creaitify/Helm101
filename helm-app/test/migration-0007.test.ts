import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0007_membership_lookup.sql'), 'utf8')

describe('migration 0007 (membership lookup)', () => {
  it('is security definer', () => {
    expect(sql).toMatch(/security definer/i)
  })

  // Exact rather than substring, for the same reason as migration-0008.test.ts:
  // the previous `toMatch(/set search_path = public/i)` passed identically on
  // the vulnerable `set search_path = public` and the hardened
  // `set search_path = public, pg_temp`, so it never verified its own name.
  // Postgres searches pg_temp implicitly FIRST unless pg_temp is named, and
  // pg_temp is writable by PUBLIC, so an unpinned SECURITY DEFINER function can
  // be pointed at an attacker's temp `users` table. pg_temp must be present AND
  // last -- `pg_temp, public` is as exploitable as omitting it entirely.
  //
  // This file is SUPERSEDED by 0008 but is still asserted: migrate.mjs replays
  // every unapplied migration in order, so a fresh database really does create
  // and grant this function before 0008 replaces it.
  const searchPathDeclarations = sql.match(/^\s*set\s+search_path\s*=.*$/gim) ?? []

  it('declares a search_path for every security definer function in the file', () => {
    // Anchored to line start: this file's commentary mentions "SECURITY
    // DEFINER" in prose several times, and those lines (all `--` comments)
    // must not be counted as function declarations.
    const securityDefinerCount = (sql.match(/^\s*security\s+definer\s*$/gim) ?? []).length
    expect(securityDefinerCount).toBeGreaterThan(0)
    expect(searchPathDeclarations).toHaveLength(securityDefinerCount)
  })

  it('pins search_path with pg_temp explicitly last (blocks temp-table shadowing)', () => {
    for (const declaration of searchPathDeclarations) {
      expect(declaration.trim()).toBe('set search_path = public, pg_temp')

      const schemas = declaration
        .replace(/^\s*set\s+search_path\s*=\s*/i, '')
        .split(',')
        .map((schema) => schema.trim().toLowerCase())
      expect(schemas).toContain('pg_temp')
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
    // The signature is the authoritative check: exactly one parameter, email in.
    expect(signature![1].trim()).toBe('p_email text')
  })

  it('returns at most one row', () => {
    expect(sql).toMatch(/limit 1;/)
  })
})

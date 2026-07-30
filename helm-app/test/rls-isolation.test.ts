import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertReadOnlyStatement } from '@/lib/server/platform-read'

const migrationsDir = resolve(process.cwd(), 'db/migrations')
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
// Concatenated text of every migration, in filename order. A table's
// `create table` block and its `enable row level security` / `force row
// level security` / `create policy` statements may live in different
// migration files (a later migration can retrofit RLS onto a table an
// earlier one created), so the "is this table protected" assertion below
// must search across the whole corpus, not just the file that created it.
const migration = migrationFiles
  .map((file) => readFileSync(resolve(migrationsDir, file), 'utf8'))
  .join('\n')
const reader = readFileSync(resolve(migrationsDir, '0004_platform_reader.sql'), 'utf8')

describe('tenant isolation invariants', () => {
  it('no tenant-owned table is missing forced RLS', () => {
    const created = [...migration.matchAll(/create table (\w+) \(/g)].map((m) => m[1])
    const tenantOwned = created.filter((table) => {
      const block = migration.slice(migration.indexOf(`create table ${table} (`))
      return block.slice(0, block.indexOf(');')).includes('tenant_id')
    })
    // Derived from parsing all migration files under db/migrations, not
    // hardcoded: as of this run it finds the tables below. If a future
    // migration adds or removes a tenant-owned table, this list -- and the
    // count logged with it -- changes accordingly; the test does not pin an
    // expected count that would need separate updating.
    console.log(`tenant-owned tables found across ${migrationFiles.length} migration file(s): ${tenantOwned.length} -- ${tenantOwned.join(', ')}`)
    expect(tenantOwned.length).toBeGreaterThan(0)
    for (const table of tenantOwned) {
      expect(migration).toContain(`alter table ${table} enable row level security;`)
      expect(migration).toContain(`alter table ${table} force row level security;`)
      expect(migration).toMatch(new RegExp(`create policy \\w+ on ${table}\\b`))
    }
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

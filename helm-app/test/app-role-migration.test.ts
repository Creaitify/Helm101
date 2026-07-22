import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0005_app_role.sql'), 'utf8')

describe('migration 0005 (app role)', () => {
  it('creates helm_app with nobypassrls', () => {
    expect(sql).toMatch(/create role helm_app login nobypassrls;/)
  })

  it('does not contain a password literal', () => {
    expect(sql).not.toMatch(/password\s+'[^']*'/i)
  })

  it('grants select/insert/update/delete but not truncate', () => {
    expect(sql).toMatch(/grant select, insert, update, delete on all tables in schema public to helm_app;/)
    expect(sql).not.toMatch(/grant[^;]*truncate[^;]*to helm_app/i)
  })

  it('does not grant any DDL (create/alter table) to helm_app', () => {
    expect(sql).not.toMatch(/grant[^;]*\bcreate\b[^;]*to helm_app/i)
    expect(sql).not.toMatch(/alter table[^;]*to helm_app/i)
  })

  it('covers future tables created by neondb_owner via default privileges, without DDL or truncate', () => {
    expect(sql).toMatch(
      /alter default privileges for role neondb_owner in schema public grant select, insert, update, delete on tables to helm_app;/,
    )
  })
})

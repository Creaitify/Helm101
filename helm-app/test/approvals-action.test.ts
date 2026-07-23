import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'app/(app)/approvals/actions.ts'), 'utf8')

describe('approval decision action', () => {
  it('is a server action', () => {
    expect(source).toMatch(/^'use server'/m)
  })

  it('derives the tenant from the session, never from an argument', () => {
    expect(source).toContain('requireTenantContext')
    expect(source).not.toMatch(/tenantId\s*:\s*(input|params|args)/)
  })

  it('only accepts the two valid decisions', () => {
    expect(source).toMatch(/approved|rejected/)
    expect(source).toContain('Invalid decision')
  })

  it('enforces the approvals.decide scope before writing', () => {
    expect(source).toContain('approvals.decide')
  })
})

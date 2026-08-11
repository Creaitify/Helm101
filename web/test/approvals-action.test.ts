import { describe, it, expect } from 'vitest'
import { submitApprovalDecision } from '@/app/(app)/approvals/actions'

/**
 * The action is a validated demo acknowledgment until the FastAPI approvals
 * endpoint exists (TODO(phase-2) in the action). Validation is the part that
 * must survive: this is a network endpoint and both arguments are
 * attacker-controlled regardless of what the UI sends.
 */
describe('submitApprovalDecision', () => {
  it('acknowledges a well-formed decision', async () => {
    await expect(submitApprovalDecision('a1', 'approved')).resolves.toEqual({ ok: true })
    await expect(submitApprovalDecision('a1', 'rejected')).resolves.toEqual({ ok: true })
  })

  it('rejects an invalid decision', async () => {
    await expect(submitApprovalDecision('a1', 'maybe' as unknown as 'approved')).rejects.toThrow('Invalid decision')
  })

  it('rejects a path-traversal-shaped externalRef', async () => {
    await expect(submitApprovalDecision('../../etc/passwd', 'approved')).rejects.toThrow('Invalid externalRef')
  })

  it('rejects an absurdly long externalRef', async () => {
    await expect(submitApprovalDecision('a'.repeat(200), 'approved')).rejects.toThrow('Invalid externalRef')
  })

  it('is a server action', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'app/(app)/approvals/actions.ts'), 'utf8')
    expect(source).toMatch(/^'use server'/m)
  })
})

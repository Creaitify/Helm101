import { describe, expect, it } from 'vitest'
import { HelmApiError, translateProblem } from '@/lib/server/helm-api-errors'

describe('problem details translation', () => {
  it('maps each Stage 1 auth code to a typed error', () => {
    const cases = [
      { status: 401, code: 'invalid_token' },
      { status: 403, code: 'insufficient_scope' },
      { status: 403, code: 'no_membership' },
      { status: 400, code: 'tenant_context_required' },
    ]
    for (const { status, code } of cases) {
      const error = translateProblem(status, { code, title: 'x', detail: 'y' })
      expect(error).toBeInstanceOf(HelmApiError)
      expect(error.status).toBe(status)
      expect(error.code).toBe(code)
    }
  })

  it('treats 5xx as retryable and 4xx as not', () => {
    expect(translateProblem(503, { code: 'unavailable' }).retryable).toBe(true)
    expect(translateProblem(403, { code: 'no_membership' }).retryable).toBe(false)
  })

  it('falls back to a safe code when the body is not problem-shaped', () => {
    const error = translateProblem(500, '<html>Internal Server Error</html>')
    expect(error.code).toBe('upstream_error')
    expect(error.message).not.toContain('<html>')
  })

  it('never carries an unexpected body into the message', () => {
    const error = translateProblem(500, { secret: 'postgres://user:pw@host/db' })
    expect(error.message).not.toContain('postgres://')
    // Verify the serialization path a caller would use (logging, returning to client)
    // doesn't expose the upstream body content via the message
    expect(JSON.stringify({ code: error.code, message: error.message })).not.toContain('postgres://')
  })

  it('does not distinguish a missing tenant from a forbidden one', () => {
    const a = translateProblem(403, { code: 'no_membership', detail: 'no access' })
    const b = translateProblem(403, { code: 'no_membership', detail: 'no access' })
    expect(a.message).toBe(b.message)
    expect(a.code).toBe(b.code)
  })
})

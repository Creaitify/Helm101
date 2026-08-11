import 'server-only'

/** The auth problem codes Stage 1's contract defines. */
export const AUTH_CODES = [
  'invalid_token',
  'insufficient_scope',
  'no_membership',
  'tenant_context_required',
] as const

/**
 * A typed failure from the HELM API.
 *
 * The message is derived only from the problem `code`, never from the raw
 * response body: an unexpected upstream error may contain a connection
 * string or stack trace, and this error is rendered to users.
 */
export class HelmApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean

  constructor(status: number, code: string, retryable: boolean) {
    super(`HELM API request failed (${code})`)
    this.name = 'HelmApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function isProblem(body: unknown): body is { code: string } {
  // Assumes body is plain JSON (never contains getters that throw).
  // This is safe: callers only pass JSON.parse() or response.json() output.
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof (body as { code: unknown }).code === 'string'
  )
}

/**
 * Convert a FastAPI response into a typed error.
 *
 * A body that is not problem-shaped collapses to `upstream_error` rather
 * than being echoed, so a raw 5xx page or a driver error never reaches a UI.
 */
export function translateProblem(status: number, body: unknown): HelmApiError {
  const retryable = status >= 500
  const code = isProblem(body) ? body.code : 'upstream_error'
  return new HelmApiError(status, code, retryable)
}

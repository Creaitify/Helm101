import 'server-only'
import { requireServerEnv } from './env'
import { HelmApiError, translateProblem } from './helm-api-errors'

/** A slow backend must not hold a page render open indefinitely. */
export const REQUEST_TIMEOUT_MS = 10_000

/**
 * The Analyst call holds a synchronous provider round-trip open on the far
 * side (see api/app/api/v1/workspace.py: the async spine is Phase 5), so a
 * model answer can legitimately outlive the render-oriented default above.
 * POST callers opt into this budget explicitly via `timeoutMs`; it is a
 * longer deadline, never no deadline.
 */
export const GENERATION_TIMEOUT_MS = 60_000

export interface HelmApiRequest {
  /** Absolute path beginning with a slash, e.g. `/api/v1/tenants`. */
  path: string
  /** The Auth0 access token. Never an id token. */
  accessToken: string
  /** Tenant selection hint. A hint only: FastAPI validates it against real membership. */
  tenantHint?: string
  signal?: AbortSignal
}

export interface HelmApiPostRequest extends HelmApiRequest {
  /** JSON-serialised as the request body. */
  body: unknown
  /** Forwarded as Idempotency-Key so a retried mutation is deduplicated upstream. */
  idempotencyKey?: string
  /** Override the request deadline. A deadline always applies; this only moves it. */
  timeoutMs?: number
}

function resolveBaseUrl(): string {
  return requireServerEnv('helmApiBaseUrl').replace(/\/+$/, '')
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    // A non-JSON error page is expected from a proxy or a crashed process.
    return undefined
  }
}

async function performRequest<T>(
  method: 'GET' | 'POST',
  request: HelmApiRequest,
  options?: { body?: unknown; idempotencyKey?: string; timeoutMs?: number },
): Promise<T> {
  const url = `${resolveBaseUrl()}${request.path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${request.accessToken}`,
    Accept: 'application/json',
  }
  if (request.tenantHint) headers['X-HELM-Active-Tenant'] = request.tenantHint
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(options?.body) : undefined,
      // `??` here would let a caller-supplied signal REPLACE the timeout rather
      // than compose with it, silently removing the render-blocking guarantee
      // above for the first caller that passes one. `AbortSignal.any` aborts on
      // whichever fires first, so the timeout always applies.
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch {
    // A DNS failure, refused connection, or timeout is retryable and must not
    // leak the underlying driver message.
    throw new HelmApiError(503, 'upstream_unreachable', true)
  }

  if (!response.ok) {
    throw translateProblem(response.status, await readBody(response))
  }

  try {
    return (await response.json()) as T
  } catch {
    // A 200 with a non-JSON body (a proxy's HTML error page, a truncated
    // response) must not escape as a raw SyntaxError: that error's message
    // embeds the response body verbatim, which is exactly the leak the
    // !ok path already guards against via readBody.
    throw new HelmApiError(502, 'upstream_invalid_response', true)
  }
}

/**
 * Perform an authenticated GET against the HELM API.
 *
 * This module is the only place in helm-app that knows the API's URL, attaches
 * a credential, or interprets a status code. Failures always surface as
 * HelmApiError, so no caller ever sees a raw upstream body.
 */
export async function helmApiGet<T>(request: HelmApiRequest): Promise<T> {
  return performRequest<T>('GET', request)
}

/**
 * Perform an authenticated JSON POST against the HELM API.
 *
 * Same custody rules as helmApiGet. The body is serialised here so no caller
 * ever hand-builds a request against the API.
 */
export async function helmApiPost<T>(request: HelmApiPostRequest): Promise<T> {
  const { body, idempotencyKey, timeoutMs, ...rest } = request
  return performRequest<T>('POST', rest, { body, idempotencyKey, timeoutMs })
}

import 'server-only'
import { requireServerEnv } from './env'
import { HelmApiError, translateProblem } from './helm-api-errors'

/** A slow backend must not hold a page render open indefinitely. */
export const REQUEST_TIMEOUT_MS = 10_000

export interface HelmApiRequest {
  /** Absolute path beginning with a slash, e.g. `/api/v1/tenants`. */
  path: string
  /** The Auth0 access token. Never an id token. */
  accessToken: string
  /** Tenant selection hint. A hint only: FastAPI validates it against real membership. */
  tenantHint?: string
  signal?: AbortSignal
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

/**
 * Perform an authenticated GET against the HELM API.
 *
 * This is the only place in helm-app that knows the API's URL, attaches a
 * credential, or interprets a status code. Failures always surface as
 * HelmApiError, so no caller ever sees a raw upstream body.
 */
export async function helmApiGet<T>(request: HelmApiRequest): Promise<T> {
  const url = `${resolveBaseUrl()}${request.path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${request.accessToken}`,
    Accept: 'application/json',
  }
  if (request.tenantHint) headers['X-HELM-Active-Tenant'] = request.tenantHint

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: request.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

  return (await response.json()) as T
}

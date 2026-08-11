import 'server-only'
import { cookies, headers } from 'next/headers'
import { getToken } from 'next-auth/jwt'
import { env } from './env'
import { helmApiGet } from './helm-api-client'
import { HelmApiError } from './helm-api-errors'

export interface TenantSummary {
  id: string
  slug: string
  name: string
}

/**
 * The API's ContextMeta: which of the caller's memberships this request was
 * resolved against. Explicitly documented by helm-api as non-authoritative --
 * UI gating only; FastAPI re-checks every permission on every request.
 */
export interface TenantContextMeta {
  tenantId: string
  tenantSlug: string
  role: string
  scopes: string[]
}

export interface TenantDirectory {
  tenants: TenantSummary[]
  meta: TenantContextMeta | null
}

/** The caller has no decodable session token. Callers redirect to /login. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('The caller is not authenticated')
    this.name = 'UnauthenticatedError'
  }
}

interface TenantListResponse {
  data: TenantSummary[]
  meta?: {
    tenant_id: string
    tenant_slug: string
    role: string
    scopes: string[]
  }
}

/**
 * List the signed-in caller's tenants, as the HELM API reports them.
 *
 * This replaces the Phase A path that queried Neon directly. A `no_membership`
 * response is a legitimate empty result; any other failure propagates, because
 * rendering a backend outage as "you belong to no tenants" would look
 * identical to having access revoked.
 *
 * `tenantHint` is forwarded as X-HELM-Active-Tenant. It is an untrusted hint:
 * FastAPI matches it (slug or UUID) against the caller's own memberships and
 * fails closed on a mismatch -- a mismatched hint is answered `no_membership`,
 * deliberately indistinguishable from having none. Callers that pass a stored
 * hint should treat an empty result as possibly-stale and retry without it.
 */
export async function listTenantsFromApi(options?: { tenantHint?: string }): Promise<TenantDirectory> {
  // Read the credential straight out of the encrypted session cookie rather
  // than from `getServerSession()`. The session object is what next-auth serves
  // as the body of `GET /api/auth/session`, so the access token deliberately is
  // not on it (see the session callback in auth.ts). `getToken` decrypts the
  // JWT in-process; the token never crosses a response boundary.
  //
  // In Next 16 `cookies()` and `headers()` are async: `cookies()` returns a
  // store exposing `getAll()` and `headers()` returns a Web `Headers` -- both
  // shapes `getToken`'s SessionStore already handles.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const token = await getToken({
    req: { cookies: cookieStore, headers: headerList } as never,
    secret: env.authSecret,
  })
  const accessToken = token?.accessToken
  if (!accessToken) throw new UnauthenticatedError()

  try {
    const response = await helmApiGet<TenantListResponse>({
      path: '/api/v1/tenants',
      accessToken,
      tenantHint: options?.tenantHint,
    })
    const meta = response.meta
    return {
      tenants: response.data,
      meta: meta
        ? {
            tenantId: meta.tenant_id,
            tenantSlug: meta.tenant_slug,
            role: meta.role,
            scopes: meta.scopes,
          }
        : null,
    }
  } catch (error) {
    if (error instanceof HelmApiError && error.code === 'no_membership') {
      return { tenants: [], meta: null }
    }
    throw error
  }
}

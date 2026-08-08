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
  role: string
}

interface TenantListResponse {
  data: TenantSummary[]
}

/**
 * List the signed-in caller's tenants, as the HELM API reports them.
 *
 * This replaces the Phase A path that queried Neon directly. A `no_membership`
 * response is a legitimate empty result; any other failure propagates, because
 * rendering a backend outage as "you belong to no tenants" would look
 * identical to having access revoked.
 */
export async function listTenantsFromApi(): Promise<TenantSummary[]> {
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
  if (!accessToken) throw new Error('The caller is not authenticated')

  try {
    const response = await helmApiGet<TenantListResponse>({
      path: '/api/v1/tenants',
      accessToken,
    })
    return response.data
  } catch (error) {
    if (error instanceof HelmApiError && error.code === 'no_membership') return []
    throw error
  }
}

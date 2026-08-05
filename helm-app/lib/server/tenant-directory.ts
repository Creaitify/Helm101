import 'server-only'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/auth'
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
  const session = await getServerSession(authOptions)
  const accessToken = (session as { accessToken?: string } | null)?.accessToken
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

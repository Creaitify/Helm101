'use server'

import type { CampaignDetail } from '@/lib/types'
import { getCampaignDetail } from '@/lib/data'

/**
 * Server-action seam for CampaignsView (a client component): it cannot import
 * @/lib/data directly once that barrel pulls in server-only repository code
 * (tenant-session's next-auth / next/headers / @neondatabase/serverless
 * chain) -- doing so fails `next build` with "'server-only' cannot be
 * imported from a Client Component module". Routing the call through a
 * 'use server' action keeps the server-only module graph out of the client
 * bundle while still letting the slide-over fetch a single campaign's detail
 * on demand.
 */
export async function fetchCampaignDetail(id: string): Promise<CampaignDetail> {
  return getCampaignDetail(id)
}

'use server'

import type { CampaignDetail } from '@/lib/types'
import { getCampaignDetail } from '@/lib/data'

// Loose sanity bound on campaign external_ref ids: non-empty, reasonably
// short, and restricted to characters actually used by the seed/migrations
// (alphanumeric, dash, underscore). This is a network endpoint -- the id is
// attacker-controlled regardless of what the UI sends -- so a malformed or
// absurdly long id is rejected before it ever reaches a query.
const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Server-action seam for CampaignsView (a client component): it cannot import
 * @/lib/data directly once that barrel pulls in server-only repository code
 * (tenant-session's next-auth / next/headers / @neondatabase/serverless
 * chain) -- doing so fails `next build` with "'server-only' cannot be
 * imported from a Client Component module". Routing the call through a
 * 'use server' action keeps the server-only module graph out of the client
 * bundle while still letting the slide-over fetch a single campaign's detail
 * on demand.
 *
 * Returns null for an invalid, unknown, or foreign (RLS-hidden) id, rather
 * than fabricating fixture data -- a probing client must get a genuine "not
 * found", not a populated 200 for any id it tries.
 */
export async function fetchCampaignDetail(id: string): Promise<CampaignDetail | null> {
  if (typeof id !== 'string' || !VALID_ID.test(id)) return null
  return getCampaignDetail(id)
}

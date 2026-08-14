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
 * @/lib/data directly because that barrel is marked 'server-only' (and in
 * phase 2 will pull in the helm-api client chain) -- importing it from a
 * client component fails `next build`. Routing the call through a
 * 'use server' action keeps the server-only module graph out of the client
 * bundle while still letting the slide-over fetch a single campaign's detail
 * on demand.
 *
 * Returns null for an invalid, unknown, or foreign (RLS-hidden) id, rather
 * than fabricating fixture data -- a probing client must get a genuine "not
 * found", not a populated 200 for any id it tries.
 */
import { getLatestShifts, listRunsByAgent, getRun } from '@/lib/server/runs-store'
import type { CreativeAsset, SeriesColor } from '@/lib/types'

export async function fetchCampaignDetail(id: string): Promise<CampaignDetail | null> {
  if (typeof id !== 'string' || !VALID_ID.test(id)) return null
  const detail = await getCampaignDetail(id)
  if (!detail) return null

  // Merge locally shipped creative variants for this campaign
  try {
    const shippedRuns = listRunsByAgent('creative', 20)
    const extraCreatives: CreativeAsset[] = []
    for (const run of shippedRuns) {
      if (run.runId.startsWith('ship-')) {
        const full = getRun(run.runId)
        if (full) {
          const state = JSON.parse(full.stateJson)
          if (state.action === 'ship_variant' && (!state.target_campaign || state.target_campaign === id)) {
            const v = state.variant
            extraCreatives.push({
              id: v.id || run.runId,
              kind: v.kind || 'copy',
              label: v.headline || 'Studio Variant',
              status: 'live',
              grad: v.grad || (['violet', 'sky'] as [SeriesColor, SeriesColor]),
            })
          }
        }
      }
    }
    if (extraCreatives.length > 0) {
      return {
        ...detail,
        creatives: [...extraCreatives, ...detail.creatives],
      }
    }
  } catch {}

  return detail
}

/** Fetch the latest approved/pending budget shifts from the agent runs store. */
export async function getRecentBudgetShifts(): Promise<
  Array<{ runId: string; shifts: any[]; updatedAt: string }>
> {
  try {
    return getLatestShifts(5)
  } catch {
    return []
  }
}

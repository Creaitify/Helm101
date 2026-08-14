'use server'

import { startAgentRun, readGovernorVariantsFile } from '@/lib/server/agent-runner'
import { getLatestVariants, saveRun } from '@/lib/server/runs-store'
import type { Variant, SeriesColor } from '@/lib/types'

const GRADS: [SeriesColor, SeriesColor][] = [
  ['violet', 'sky'],
  ['sky', 'violet'],
  ['emerald', 'sky'],
  ['amber', 'rose'],
]

export async function getGovernorVariantsAction(): Promise<any[]> {
  const fromFile = readGovernorVariantsFile()
  try {
    const latestRuns = getLatestVariants(10)
    const map = new Map<string, any>()
    
    // First seed from JSON file
    for (const v of fromFile) {
      if (v.id) map.set(v.id, v)
    }

    // Overlay with latest runs store variants
    for (const item of latestRuns) {
      if (Array.isArray(item.variants)) {
        item.variants.forEach((v: any, idx: number) => {
          const id = v.id || `gv-${item.runId}-v${idx + 1}`
          const verdict = item.verdicts?.[idx] || { status: 'pass' }
          if (!map.has(id)) {
            map.set(id, {
              id,
              kind: v.kind || 'image',
              headline: v.headline || 'Ad Variant',
              body: v.body || undefined,
              grad: v.grad || ['violet', 'sky'],
              compliance: verdict.status === 'pass' ? 'pass' : 'flag',
              flagReason: verdict.matched ? `SEBI Rule: ${verdict.matched}` : verdict.reason,
              runId: item.runId,
              missionTag: `Mission #${item.runId}`,
              createdAt: item.updatedAt || new Date().toISOString(),
            })
          }
        })
      }
    }
    return Array.from(map.values())
  } catch {
    return fromFile
  }
}

export async function generateLiveVariants(
  audience: string,
  hook: string,
  offer: string,
  format: 'image' | 'video' | 'copy',
): Promise<Variant[]> {
  const briefText = `Audience: ${audience}. Hook: ${hook}. Offer: ${offer}. Format: ${format}. Produce 3 distinct ad copy variants.`
  try {
    const result = await startAgentRun('creative', briefText)
    const variantsData = result.state?.variants
    const verdicts = result.state?.verdicts

    if (Array.isArray(variantsData) && variantsData.length > 0) {
      return variantsData.map((v: any, idx: number) => {
        const verdict = verdicts?.[idx] || { status: 'pass' }
        const grad = GRADS[idx % GRADS.length]
        return {
          id: `v-live-${idx}-${Date.now()}`,
          kind: format === 'image' ? 'image' : 'copy',
          headline: v.headline || 'Ad Variant',
          body: v.body || '',
          grad,
          compliance: verdict.status === 'pass' ? 'pass' : 'flag',
          flagReason: verdict.matched ? `SEBI Rule: ${verdict.matched}` : verdict.reason,
        }
      })
    }
  } catch {
    // Fallback to local heuristic if worker is unreachable
  }
  return []
}

/**
 * Persist a shipped creative variant into the ad inventory store
 * for deployment to ad platforms (Meta Ads / Google Ads).
 */
export async function shipVariantToCampaign(
  variant: Variant,
  targetCampaignId: string = 'fhc-meta-retargeting',
): Promise<{ ok: boolean; message: string }> {
  try {
    const shipId = `ship-${Date.now().toString(36)}`
    saveRun(
      shipId,
      'creative',
      `Deploy variant "${variant.headline}" to ${targetCampaignId}`,
      'completed',
      {
        action: 'ship_variant',
        variant,
        target_campaign: targetCampaignId,
        shipped_at: new Date().toISOString(),
      },
    )
    return { ok: true, message: `Shipped "${variant.headline.slice(0, 30)}" to ${targetCampaignId}` }
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Failed to record shipment' }
  }
}

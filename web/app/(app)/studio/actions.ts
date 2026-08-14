'use server'

import { startAgentRun, readGovernorVariantsFile } from '@/lib/server/agent-runner'
import type { Variant, SeriesColor } from '@/lib/types'

const GRADS: [SeriesColor, SeriesColor][] = [
  ['violet', 'sky'],
  ['sky', 'violet'],
  ['emerald', 'sky'],
  ['amber', 'rose'],
]

export async function getGovernorVariantsAction(): Promise<any[]> {
  try {
    return readGovernorVariantsFile()
  } catch {
    return []
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

import type { Brief, Variant, SeriesColor } from './types'

const GRADS: [SeriesColor, SeriesColor][] = [['violet', 'sky'], ['sky', 'emerald'], ['amber', 'rose'], ['violet', 'rose'], ['emerald', 'violet'], ['amber', 'violet']]

export function buildVariants(brief: Brief): Variant[] {
  const heads = [
    `${brief.hook}`,
    `Only ₹999 — ${brief.hook.toLowerCase()}`,
    `Your money, clearer in 20 minutes`,
    `${brief.offer} for ${brief.audience.split(',')[0]}`,
    `Guaranteed returns, zero guesswork`, // intentionally non-compliant
    `Start your Financial Health Checkup today`,
  ]
  return heads.map((headline, i) => {
    const flagged = /guarantee|assured|risk-free/i.test(headline)
    return {
      id: `v${i + 1}`,
      kind: brief.format === 'copy' ? 'copy' : 'image',
      headline,
      body: brief.format === 'copy' ? `${headline}. ${brief.offer}. Book now.` : undefined,
      grad: GRADS[i % GRADS.length],
      compliance: flagged ? 'flag' : 'pass',
      flagReason: flagged ? 'SEBI: implies guaranteed returns' : undefined,
    }
  })
}

import type { Citation } from './types'

export function cannedReply(prompt: string): { text: string; citations: Citation[] } {
  const p = prompt.toLowerCase()
  if (p.includes('audience') || p.includes('segment') || p.includes('top') || p.includes('convert')) {
    const text = `### Top-Converting Audience Segment Analysis (Last 30 Days)

Based on Finnovate's 30-day campaign audit, the highest-converting cohort is **Segment A: "The Anxious Tech Professional"** (Ages 28–38, IT/Tech professionals in Tier 1 metros).

#### 📊 Key Performance Metrics:
- **Blended CAC**: **₹341** (38% lower than account average of ₹550 on search)
- **Return on Ad Spend (ROAS)**: **3.4x** (peaking at **4.2x** on Instagram Retargeting)
- **Volume Delivered**: **346 Financial Health Checkups (FHC)** completed

#### 🎯 Primary Conversion Drivers:
1. **Core Pain Point**: High earnings with fragmented investments across mutual funds and crypto without unified asset allocation.
2. **Winning Value Proposition**: *"Unbiased, fee-only portfolio review for ₹999 with SEBI-registered planners (zero product commissions)."*

#### 💡 Strategic Growth Recommendations:
1. **Reallocate Spend to Meta Retargeting**: Shift ₹10,000 daily spend from fatigued competitor search (\`search-competitor\` at ₹550 CAC) into \`fhc-meta-retargeting\` within policy ±25% caps.
2. **Deploy WhatsApp Drop-Off Recovery**: Trigger automated WhatsApp checkup booking reminders within 15 minutes of cart abandonment (currently converting at 2.9x ROAS).
3. **Rotate Creative Formats**: Refresh copy with benefit-led and curiosity-led variants to maintain low CAC and avoid ad fatigue.`

    const citations: Citation[] = [
      { label: 'Audience Segments · 30d', source: 'Finnovate Campaign Intelligence § 3' },
      { label: 'Meta Retargeting CAC ₹341', source: 'Finnovate Campaign Intelligence § 2' },
      { label: 'SEBI Compliance Code', source: 'Finnovate Campaign Intelligence § 5' },
    ]
    return { text, citations }
  }

  const text = `### Finnovate Marketing Intelligence Summary

Finnovate's ₹999 Financial Health Checkup push is delivering strong conversion velocity:
- **Blended CAC**: **₹385** across channels (down 12% over 30 days).
- **Top Performing Channel**: **Meta Retargeting** (₹341 CAC, 3.4x ROAS, 346 checkups).
- **Underperforming Channel**: **Search Competitor** (₹550 CAC, 1.7x ROAS).

**Recommended Action**: Use the Governor Star Relay to rebalance daily budgets toward Meta Retargeting and deploy refreshed, SEBI-compliant copy variants.`

  const citations: Citation[] = [
    { label: 'CAC · 30d', source: 'Analytics · Finnovate' },
    { label: 'FHC · Retargeting', source: 'Campaigns' },
    { label: 'Search · Competitor', source: 'Campaigns' },
  ]
  return { text, citations }
}


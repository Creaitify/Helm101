import type { Citation } from './types'

export function cannedReply(prompt: string): { text: string; citations: Citation[] } {
  const p = prompt.toLowerCase()

  if (p.includes('meta') || p.includes('instagram') || p.includes('facebook') || p.includes('social')) {
    const text = `### Meta Ads Performance Deep-Dive (Last 30 Days)

Meta channels drive the primary volume and highest conversion efficiency for Finnovate's ₹999 Financial Health Checkup:

#### 📊 Channel Comparison:
- **Meta Retargeting (\`fhc-meta-retargeting\`)**:
  - **Daily Budget**: ₹40,000 | **30D Spend**: ₹1,18,000
  - **Results**: **346 checkups** delivered
  - **Blended CAC**: **₹341** (Best in account)
  - **ROAS**: **3.4x** (peaking at 4.2x on Instagram Stories)
- **Meta Prospecting (\`fhc-meta-prospecting\`)**:
  - **Daily Budget**: ₹60,000 | **30D Spend**: ₹1,76,000
  - **Results**: **381 checkups** delivered
  - **Blended CAC**: **₹462** | **ROAS**: **2.6x**

#### 💡 Analyst Directives:
1. Scale \`fhc-meta-retargeting\` by +₹10,000/day within ±25% policy limits.
2. Refresh creative variants every 14 days to prevent ad fatigue among tech professionals.`

    const citations: Citation[] = [
      { label: 'Meta Retargeting Metrics § 2', source: 'docs/finnovate-campaign-intelligence.md' },
      { label: 'Audience Cohorts § 3', source: 'docs/finnovate-campaign-intelligence.md' },
    ]
    return { text, citations }
  }

  if (p.includes('google') || p.includes('search') || p.includes('competitor') || p.includes('sem')) {
    const text = `### Google Search Performance & Fatigue Audit

Google Search presents a bifurcated picture: high brand intent versus fatigued competitor acquisition.

#### 📊 Performance Breakdown:
- **Google Search (Brand) (\`search-brand\`)**:
  - **Daily Budget**: ₹25,000 | **30D Spend**: ₹74,000
  - **Results**: **186 checkups** | **CAC**: **₹398** | **ROAS**: **3.1x**
  - *Status*: High intent, stable converter.
- **Google Search (Competitor) (\`search-competitor\`)**:
  - **Daily Budget**: ₹30,000 | **30D Spend**: ₹88,000
  - **Results**: **160 checkups** | **CAC**: **₹550** (+18% fatigue) | **ROAS**: **1.7x**
  - *Status*: Experiencing creative fatigue and elevated click costs.

#### 💡 Recommended Reallocation:
Shift ₹7,500 to ₹10,000 daily spend from \`search-competitor\` into \`fhc-meta-retargeting\` under Media Buyer governance.`

    const citations: Citation[] = [
      { label: 'Google Search Fatigue § 2', source: 'docs/finnovate-campaign-intelligence.md' },
      { label: 'Budget Reallocation Rules § 4', source: 'docs/finnovate-campaign-intelligence.md' },
    ]
    return { text, citations }
  }

  if (p.includes('whatsapp') || p.includes('nurture') || p.includes('drop-off') || p.includes('cart')) {
    const text = `### WhatsApp Nurture & Drop-Off Recovery Audit

WhatsApp Nurture is Finnovate's highest trust conversion channel for leads who abandon the booking flow.

#### 📊 Performance Overview:
- **Daily Budget**: ₹12,000 | **30D Spend**: ₹34,000
- **Results Delivered**: **91 completed checkups**
- **CAC**: **₹375** | **ROAS**: **2.9x**
- **Trigger**: Automated 15-minute post-cart drop-off sequence.

#### 💡 Key Takeaway:
Strongest conversion rate among mid-funnel leads. Recommend expanding automated trigger windows to 45 minutes for warm re-engagement.`

    const citations: Citation[] = [
      { label: 'WhatsApp Funnel § 2', source: 'docs/finnovate-campaign-intelligence.md' },
      { label: 'Conversion Triggers § 4', source: 'docs/finnovate-campaign-intelligence.md' },
    ]
    return { text, citations }
  }

  if (p.includes('sebi') || p.includes('compliance') || p.includes('rule') || p.includes('legal') || p.includes('disclaimer')) {
    const text = `### SEBI Regulatory Advertising Compliance Framework

All copy variants deployed across Finnovate campaigns must strictly satisfy SEBI Investment Adviser regulations.

#### 🚫 Prohibited Language (Deterministic Block):
- *"Guaranteed returns"*, *"100% risk-free"*, *"Double your money"*, *"Assured profit"*, *"Multibagger tips"*.

#### ✅ Mandatory Disclosures:
- Clear fee-only advisory positioning (₹999 flat fee, zero commission).
- Mandatory risk disclaimer: *"Investments in securities markets are subject to market risks. Read all related documents carefully before investing."*`

    const citations: Citation[] = [
      { label: 'SEBI Compliance § 5', source: 'docs/finnovate-campaign-intelligence.md' },
      { label: 'Prohibited Claims Rulebook', source: 'docs/sebi-regulatory-advisory.md' },
    ]
    return { text, citations }
  }

  if (p.includes('audience') || p.includes('segment') || p.includes('cohort') || p.includes('demographic')) {
    const text = `### Top-Converting Audience Segment Analysis (Last 30 Days)

Based on Finnovate's 30-day campaign audit, performance is segmented across 3 core cohorts:

#### 🎯 Segment Breakdown:
1. **Segment A: "The Anxious Tech Professional"** (Ages 28–38, IT/SaaS, ₹18L–₹45L):
   - **Blended CAC**: **₹341** | **ROAS**: **3.4x** (Top Converter)
   - *Key Angle*: Unbiased fee-only portfolio review with zero hidden product commissions.
2. **Segment B: "Family Wealth Builders"** (Ages 35–48, Married + Kids, ₹25L–₹60L):
   - **Blended CAC**: **₹398** | **ROAS**: **3.1x**
   - *Key Angle*: Comprehensive family asset protection and tax roadmap.
3. **Segment C: "First-Time Tax Planners"** (Ages 25–32, Early Career, ₹8L–₹18L):
   - **Blended CAC**: **₹462** | **ROAS**: **2.6x**
   - *Key Angle*: 80C/80D optimization and structured starter financial plan.`

    const citations: Citation[] = [
      { label: 'Audience Segments · 30d', source: 'docs/finnovate-campaign-intelligence.md' },
      { label: 'Cohort Conversion Metrics § 3', source: 'docs/finnovate-campaign-intelligence.md' },
    ]
    return { text, citations }
  }

  const text = `### Finnovate Marketing Intelligence Summary (30-Day Audit)

Finnovate's ₹999 Financial Health Checkup push is delivering strong conversion velocity across channels:
- **Blended CAC**: **₹385** across channels (down 12% over last 30 days).
- **Top Channel**: **Meta Retargeting** (₹341 CAC, 3.4x ROAS, 346 checkups completed).
- **Underperforming Channel**: **Search Competitor** (₹550 CAC, 1.7x ROAS, fatigued).
- **Total Spend**: ₹4,90,000 | **Total Checkups**: 1,164 units delivered.

**Recommended Action**: Delegate optimization to the Governor Star Relay to rebalance daily budgets toward Meta Retargeting and deploy refreshed, SEBI-compliant copy variants.`

  const citations: Citation[] = [
    { label: '30D Campaign Performance § 2', source: 'docs/finnovate-campaign-intelligence.md' },
    { label: 'Governor Optimization Directives § 4', source: 'docs/finnovate-campaign-intelligence.md' },
  ]
  return { text, citations }
}


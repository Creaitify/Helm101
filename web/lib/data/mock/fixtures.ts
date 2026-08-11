import type {
  Tenant,
  KpiMetric,
  MetricCell,
  FunnelStage,
  ChannelRow,
  Agent,
  GatewayBudget,
  RoutingRow,
  ModelSplitRow,
  TrainingJob,
  PermissionRow,
  User,
  IntegrationRow,
  ActivityEvent,
  Flag,
  AnalyticsPanels,
  CampaignFull,
  AdGroup,
  CreativeAsset,
  CampaignDetail,
  Brief,
  PromptTemplate,
  ApprovalItem,
  IntegrationDetail,
} from '../../types'

// Values ported verbatim (where directly shown) or reconciled (where derived) from helm-mockup-v4.html.

export const tenant: Tenant = {
  id: 'finnovate',
  name: 'Finnovate',
  region: 'ap-south-1',
  env: 'prod',
}

export const kpis: KpiMetric[] = [
  {
    label: 'Cost per Checkup',
    value: '₹412',
    deltaLabel: '12% better · tgt ₹450',
    direction: 'up',
    sparkline: [30, 32, 28, 34, 30, 36, 33, 38, 35, 40, 38],
    color: 'emerald',
  },
  {
    label: 'Checkups Sold',
    value: '1,204',
    deltaLabel: '8.3% · ₹12.0L rev',
    direction: 'up',
    sparkline: [36, 33, 34, 28, 30, 24, 26, 20, 22, 16, 12],
    color: 'violet',
  },
  {
    label: 'Blended ROAS',
    value: '2.9×',
    deltaLabel: '0.4× vs prior',
    direction: 'up',
    sparkline: [34, 32, 30, 31, 26, 28, 22, 24, 18, 20, 15],
    color: 'sky',
  },
  {
    label: 'Ad Spend',
    value: '₹4.96L',
    deltaLabel: '4.1% · 95% of budget',
    direction: 'down',
    sparkline: [30, 28, 32, 26, 30, 24, 28, 22, 26, 20, 24],
    color: 'amber',
  },
]

export const metricStrip: MetricCell[] = [
  { label: 'Impressions', value: '2.14M', deltaLabel: '▲ 9.2%', direction: 'up' },
  { label: 'Reach', value: '842K', deltaLabel: '▲ 5.1%', direction: 'up' },
  { label: 'Frequency', value: '2.54', deltaLabel: '— 0.1', direction: 'flat' },
  { label: 'CTR', value: '3.10%', deltaLabel: '▲ 0.3pp', direction: 'up' },
  { label: 'CPC', value: '₹7.48', deltaLabel: '▼ 4%', direction: 'up' },
  { label: 'CPM', value: '₹232', deltaLabel: '▲ 6%', direction: 'down' },
  { label: 'Lead CVR', value: '10.1%', deltaLabel: '▲ 1.2pp', direction: 'up' },
  { label: 'Quality', value: '8.2/10', deltaLabel: '▲ 0.4', direction: 'up' },
  { label: 'AOV', value: '₹999', deltaLabel: '—', direction: 'flat' },
  { label: 'LTV 90d', value: '₹6,840', deltaLabel: '▲ 3%', direction: 'up' },
  { label: 'LTV:CAC', value: '16.6×', deltaLabel: '▲ 1.1×', direction: 'up' },
  { label: 'Payback', value: '11 days', deltaLabel: '▼ 2d', direction: 'up' },
  { label: 'CPL', value: '₹41.5', deltaLabel: '▼ 3%', direction: 'up' },
  { label: 'Reply Rate', value: '24.6%', deltaLabel: '▲ 3pp', direction: 'up' },
  { label: 'Advisory', value: '143', deltaLabel: '▲ 21%', direction: 'up' },
  { label: 'SEBI Blocks', value: '2', deltaLabel: 'wk', direction: 'flat' },
]

export const analyticsPanels: AnalyticsPanels = {
  heatmapRows: [[1, 1, 0, 1, 2, 3, 4, 3, 4, 5, 6, 4], [1, 0, 1, 2, 3, 4, 5, 4, 5, 6, 8, 5], [0, 1, 1, 2, 3, 4, 4, 5, 4, 6, 7, 4], [1, 1, 2, 2, 3, 3, 5, 4, 5, 6, 6, 5], [2, 1, 1, 3, 4, 4, 5, 6, 5, 6, 7, 6], [3, 2, 2, 3, 3, 4, 4, 3, 4, 5, 5, 4], [2, 2, 1, 2, 3, 3, 4, 3, 4, 4, 4, 3]],
  goalGauges: [{ pct: 81, color: 'emerald', label: 'CAC' }, { pct: 92, color: 'violet', label: 'Volume' }, { pct: 55, color: 'amber', label: 'Advisory' }],
  leaderboard: [{ code: 'V-07', grad: 'linear-gradient(135deg,var(--violet),var(--indigo))', title: '"Retire at 50" · Reel', sub: 'Meta · video · 18s', pct: 94, stat: '₹298' }, { code: 'V-12', grad: 'linear-gradient(135deg,var(--sky),var(--emerald))', title: '"₹999 = clarity" · Static', sub: 'Meta · image · 1:1', pct: 82, stat: '₹341' }, { code: 'V-04', grad: 'linear-gradient(135deg,var(--amber),var(--rose))', title: '"Tax season" · Carousel', sub: 'Google · image', pct: 64, stat: '₹455' }],
  approvalsPreview: [{ code: 'MB', color: 'var(--amber)', title: '+₹15K to Lookalike 2%', sub: 'Media Buyer · propose' }, { code: 'CR', color: 'var(--violet)', title: 'Ship 4 new reels', sub: 'Creative · propose' }, { code: 'AU', color: 'var(--sky)', title: 'New suppression list', sub: 'Audience · propose' }],
}

// Reconciliation invariant: channels[].checkups must sum to the Checkups stage value (1204).
// Meta 612 + Google 401 + WhatsApp 128 + Email 63 = 1204.
export const funnel: FunnelStage[] = [
  { label: 'Impressions', value: 2_140_000, display: '2.14M', widthPct: 100 },
  { label: 'Clicks', value: 66_300, display: '66.3K', widthPct: 62, convLabel: '3.1% CTR' },
  { label: 'Leads', value: 11_900, display: '11.9K', widthPct: 44, convLabel: '18% capture' },
  { label: 'Checkups', value: 1_204, display: '1,204', widthPct: 26, convLabel: '10.1% purchase' },
  { label: 'Advisory', value: 143, display: '143', widthPct: 13, convLabel: '11.9% upsell' },
]

export const channels: ChannelRow[] = [
  { name: 'Meta', color: 'violet', spend: 231_000, checkups: 612, cac: 377, roas: 2.65 },
  { name: 'Google', color: 'amber', spend: 178_000, checkups: 401, cac: 444, roas: 2.25 },
  { name: 'WhatsApp', color: 'emerald', spend: 52_000, checkups: 128, cac: 406, roas: 2.46 },
  { name: 'Email', color: 'sky', spend: 35_000, checkups: 63, cac: 556, roas: 1.8 },
]

export const activity: ActivityEvent[] = [
  { agent: 'Media Buyer', title: 'Budget shift', sub: '₹4K → Retargeting · r_8a3f12', dot: 'emerald', latency: '340ms', tokens: '2.1k tok' },
  { agent: 'Compliance', title: 'Compliance flag', sub: 'ad copy V-13 · guaranteed-return', dot: 'amber', latency: '892ms', tokens: '1.4k tok', tag: 'REVIEW' },
  { agent: 'Reply Router', title: '12 drafts', sub: 'WhatsApp inbound · l_8a3ed1', dot: 'violet', latency: '1.1s', tokens: '8.0k tok' },
  { agent: 'Creative', title: 'Shipped V-14', sub: 'Meta · reel 18s', dot: 'emerald', latency: '1.4s', tokens: '18.9k' },
  { agent: 'Audience', title: 'Sync', sub: 'WhatsApp BSP degraded', dot: 'rose', latency: '3.2s', tokens: '640', tag: 'ERR' },
  { agent: 'Analyst', title: 'Daily readout', sub: 'attribution rebuilt', dot: 'emerald', latency: '720ms', tokens: '7.2k' },
  { agent: 'Nurture', title: '88 reminders', sub: 'abandoned checkout', dot: 'emerald', latency: '410ms', tokens: '2.0k' },
]

export const agents: Agent[] = [
  { code: 'GV', name: 'Governor', role: 'supervisor', tier: 'human', runs: '214', success: '99.1%', tokens: '1.2M', cost: '$18.40', enabled: true, grad: ['violet', 'sky'] },
  { code: 'MB', name: 'Media Buyer', role: 'budget/bid', tier: 'propose', runs: '88', success: '96.4%', tokens: '640K', cost: '$9.20', enabled: true, grad: ['sky', 'violet'] },
  { code: 'AN', name: 'Analyst', role: 'attribution', tier: 'auto', runs: '312', success: '99.6%', tokens: '890K', cost: '$11.80', enabled: true, grad: ['emerald', 'sky'] },
  { code: 'RR', name: 'Reply Router', role: 'inbound', tier: 'auto', runs: '1.4K', success: '94.2%', tokens: '2.1M', cost: '$6.40', enabled: true, grad: ['violet', 'rose'] },
  { code: 'AU', name: 'Audience', role: 'segments', tier: 'propose', runs: '46', success: '97.8%', tokens: '410K', cost: '$5.90', enabled: true, grad: ['amber', 'rose'] },
  { code: 'NU', name: 'Nurture', role: 'retargeting', tier: 'auto', runs: '520', success: '98.1%', tokens: '720K', cost: '$8.10', enabled: true, grad: ['emerald', 'violet'] },
  { code: 'CR', name: 'Creative', role: 'generation', tier: 'propose', runs: '72', success: '91.0%', tokens: '1.5M', cost: '$34.20', enabled: true, grad: ['rose', 'violet'] },
  { code: 'CO', name: 'Compliance', role: 'SEBI veto', tier: 'human', runs: '7', success: '100%', tokens: '380K', cost: '$4.10', enabled: true, grad: ['rose', 'amber'] },
]

export const gatewayBudgets: GatewayBudget[] = [
  { provider: 'Anthropic · Claude (reasoning/agents)', spent: 412, cap: 600 },
  { provider: 'OpenAI · GPT (copy/aux)', spent: 188, cap: 300 },
  { provider: 'Gemini · Nano Banana (image)', spent: 96, cap: 150 },
  { provider: 'Gemini · Veo 3.1 (video)', spent: 243, cap: 250 },
]

export const routing: RoutingRow[] = [
  { task: 'reasoning.plan', model: 'Anthropic · claude', calls: '4,120', latency: '1.2s' },
  { task: 'copy.variant', model: 'OpenAI · gpt', calls: '2,860', latency: '640ms' },
  { task: 'image.generate', model: 'Gemini · nano-banana-2', calls: '312', latency: '3.1s' },
  { task: 'video.generate', model: 'Gemini · veo-3.1', calls: '28', latency: '92s' },
  { task: 'embed', model: 'OpenAI · embeddings', calls: '18,400', latency: '80ms' },
]

export const modelSplit: ModelSplitRow[] = [
  { model: 'claude-sonnet', color: 'violet', tokens: '4.4M', pct: 52.4 },
  { model: 'gpt-4o', color: 'sky', tokens: '2.2M', pct: 26.7 },
  { model: 'claude-haiku', color: 'emerald', tokens: '966K', pct: 11.5 },
  { model: 'gemini-flash', color: 'amber', tokens: '554K', pct: 6.6 },
  { model: 'claude-opus', color: 'rose', tokens: '31K', pct: 0.3 },
]

export const trainingJobs: TrainingJob[] = [
  { model: 'Reply-Intent v3', type: 'fine-tune (small)', status: 'running', metric: 'loss 0.21', progress: '62% · ep 2/3' },
  { model: 'Lead-Score v2', type: 'gradient boosting', status: 'deployed', metric: 'AUC 0.88', progress: '100%' },
  { model: 'Creative-Rank', type: 'ranking model', status: 'queued', metric: '—', progress: 'dataset 8.2K' },
  { model: 'Send-Time Optimiser', type: 'rules → learned', status: 'deployed', metric: '+8% opens', progress: '100%' },
  { model: 'Budget-Allocation', type: 'bandit', status: 'shadow', metric: '+4% ROAS', progress: 'A/B 50%' },
]

export const permissions: PermissionRow[] = [
  {
    capability: 'System config & agents',
    roles: { master: 'yes', agency: 'no', strategist: 'no', creative: 'no', analyst: 'no', viewer: 'no' },
  },
  {
    capability: 'Model training / tuning',
    roles: { master: 'yes', agency: 'partial', strategist: 'no', creative: 'no', analyst: 'no', viewer: 'no' },
  },
  {
    capability: 'Budget shifts',
    roles: { master: 'yes', agency: 'yes', strategist: 'yes', creative: 'no', analyst: 'no', viewer: 'no' },
  },
  {
    capability: 'Approve creative',
    roles: { master: 'yes', agency: 'yes', strategist: 'yes', creative: 'partial', analyst: 'no', viewer: 'no' },
  },
  {
    capability: 'Manage integrations',
    roles: { master: 'yes', agency: 'yes', strategist: 'no', creative: 'no', analyst: 'no', viewer: 'no' },
  },
  {
    capability: 'View analytics',
    roles: { master: 'yes', agency: 'yes', strategist: 'yes', creative: 'yes', analyst: 'yes', viewer: 'yes' },
  },
]

export const users: User[] = [
  { id: 'u1', name: 'Aniket', email: 'aniket@letstute.com', role: 'master', status: 'active' },
  { id: 'u2', name: 'Priya S.', email: 'priya@letstute.com', role: 'agency', status: 'active' },
  { id: 'u3', name: 'Rohan V.', email: 'rohan@letstute.com', role: 'strategist', status: 'active' },
  { id: 'u4', name: 'Diya P.', email: 'diya@letstute.com', role: 'creative', status: 'active' },
  { id: 'u5', name: 'Finnovate CMO', email: 'cmo@finnovate.in', role: 'viewer', status: 'invited' },
]

export const integrations: IntegrationRow[] = [
  { name: 'Meta Ads', auth: 'OAuth 2.1', status: 'healthy', lastSync: '2m ago', calls: '3,412', errors: 0 },
  { name: 'Google Ads', auth: 'OAuth 2.1', status: 'healthy', lastSync: '1m ago', calls: '2,180', errors: 0 },
  { name: 'GA4', auth: 'OAuth 2.1', status: 'healthy', lastSync: '4m ago', calls: '1,024', errors: 0 },
  { name: 'WhatsApp / BSP', auth: 'API key', status: 'degraded', lastSync: '18m ago', calls: '642', errors: 14 },
  { name: 'Instantly', auth: 'API key', status: 'healthy', lastSync: '3m ago', calls: '918', errors: 0 },
  { name: 'Mailchimp', auth: 'OAuth 2.1', status: 'healthy', lastSync: '6m ago', calls: '204', errors: 0 },
  { name: 'n8n', auth: 'token', status: 'paused', lastSync: '2h ago', calls: '0', errors: 0 },
]

export const guardrails: Flag[] = [
  { title: 'Prompt-injection guard', desc: 'input · blocks tool-hijack on fetched content', on: true },
  { title: 'PII detection & redaction', desc: 'strip investor PII before provider egress', on: true },
  { title: 'SEBI compliance filter', desc: 'output · blocks guaranteed-return / misleading claims', on: true },
  { title: 'Grounding / citation check', desc: 'require retrieval grounding for factual answers', on: true },
  { title: 'Content safety', desc: 'standard safety categories', on: true },
]

export const featureFlags: Flag[] = [
  { title: 'Auto-publish creative', desc: 'ship without human approval (off for SEBI)', on: false },
  { title: 'Agent autonomy', desc: 'allow AUTO-tier agents to act', on: true },
  { title: 'Embedded workspace', desc: 'internal LLM workspace for the team', on: true },
  { title: 'Client read-only view', desc: 'expose locked dashboard to Finnovate', on: true },
  { title: 'Vector retrieval (RAG)', desc: 'ground workspace on tenant data', on: true },
]

export const campaignsFull: CampaignFull[] = [
  { id: 'c1', name: 'FHC · Retargeting', channel: 'Meta', channelColor: 'violet', status: 'active', spend: 156000, budget: 230000, pacingPct: 68, results: 458, cac: 341, roas: 3.2, objective: 'Lowest CAC / checkup', startedAt: '2026-06-18' },
  { id: 'c2', name: 'FHC · Lookalike 2%', channel: 'Meta', channelColor: 'violet', status: 'active', spend: 92000, budget: 100000, pacingPct: 92, results: 202, cac: 455, roas: 2.5, objective: 'Scale prospecting', startedAt: '2026-06-25' },
  { id: 'c3', name: 'Search · Brand', channel: 'Google', channelColor: 'amber', status: 'active', spend: 54000, budget: 100000, pacingPct: 54, results: 181, cac: 298, roas: 3.4, objective: 'Capture intent', startedAt: '2026-05-30' },
  { id: 'c4', name: 'Reels · Awareness', channel: 'Meta', channelColor: 'violet', status: 'review', cac: null, spend: 0, budget: 80000, pacingPct: 0, results: 0, roas: 0, objective: 'Top-of-funnel reach', startedAt: '2026-07-15' },
  { id: 'c5', name: 'FHC · Prospecting', channel: 'Google', channelColor: 'amber', status: 'active', spend: 83000, budget: 80000, pacingPct: 104, results: 136, cac: 612, roas: 1.9, objective: 'Volume', startedAt: '2026-06-10' },
  { id: 'c6', name: 'Email · Nurture', channel: 'Email', channelColor: 'sky', status: 'paused', spend: 7000, budget: 35000, pacingPct: 20, results: 63, cac: 556, roas: 1.9, objective: 'Reactivate leads', startedAt: '2026-05-20' },
  { id: 'c7', name: 'WhatsApp · Reminder', channel: 'WhatsApp', channelColor: 'emerald', status: 'active', spend: 41000, budget: 52000, pacingPct: 79, results: 128, cac: 406, roas: 3.1, objective: 'Abandoned checkout', startedAt: '2026-06-05' },
  { id: 'c8', name: 'Search · Competitor', channel: 'Google', channelColor: 'amber', status: 'paused', spend: 22000, budget: 40000, pacingPct: 55, results: 40, cac: 550, roas: 1.7, objective: 'Conquesting', startedAt: '2026-06-28' },
]
const AD_GROUPS: AdGroup[] = [
  { id: 'ag1', name: 'Age 30–45 · Metro', status: 'active', spend: 78000, results: 240 },
  { id: 'ag2', name: 'Age 45–60 · Metro', status: 'active', spend: 54000, results: 150 },
  { id: 'ag3', name: 'Retarget · 7d site', status: 'paused', spend: 24000, results: 68 },
]
const CREATIVE_ASSETS: CreativeAsset[] = [
  { id: 'cr1', kind: 'video', label: '"Retire at 50" · Reel', status: 'live', grad: ['violet', 'sky'] },
  { id: 'cr2', kind: 'image', label: '"₹999 = clarity" · Static', status: 'live', grad: ['sky', 'emerald'] },
  { id: 'cr3', kind: 'image', label: '"Tax season" · Carousel', status: 'review', grad: ['amber', 'rose'] },
  { id: 'cr4', kind: 'copy', label: 'Primary text · v3', status: 'draft', grad: ['violet', 'rose'] },
]
export function campaignDetail(id: string): CampaignDetail {
  const campaign = campaignsFull.find((c) => c.id === id) ?? campaignsFull[0]
  const series = [22, 26, 24, 30, 28, 34, 33, 38, 36, 41, 40, 44, 43, 48]
  return { campaign, adGroups: AD_GROUPS, creatives: CREATIVE_ASSETS, series }
}
export const briefDefaults: Brief = { audience: 'Salaried professionals, 30–45, metros', hook: 'Financial clarity in 20 minutes', offer: '₹999 Financial Health Checkup', format: 'image' }
export const promptTemplates: PromptTemplate[] = [
  { id: 'p1', title: 'Ad brief', body: 'Write a Meta ad brief for the ₹999 Financial Health Checkup targeting ' },
  { id: 'p2', title: 'Audience analysis', body: 'Analyse the top-converting audience segment for the last 30 days and suggest ' },
  { id: 'p3', title: 'Reply drafting', body: 'Draft a WhatsApp reply to a lead who asked about ' },
  { id: 'p4', title: 'Report writing', body: 'Write a weekly performance summary for Finnovate covering CAC, checkups and ' },
]
export const approvals: ApprovalItem[] = [
  { id: 'a1', agent: 'Media Buyer', agentCode: 'MB', action: 'Budget shift', summary: '+₹15K to Lookalike 2%', payload: 'Move ₹15,000/day from FHC · Prospecting (CAC ₹612) to FHC · Lookalike 2% (CAC ₹455).', proposedAt: '14:02', checks: [{ label: 'Within daily cap', status: 'pass' }, { label: 'CAC guardrail', status: 'pass' }, { label: 'Pacing > 90%', status: 'warn' }] },
  { id: 'a2', agent: 'Creative', agentCode: 'CR', action: 'Ship creative', summary: 'Ship 4 new reels', payload: 'Publish 4 reel variants (V-14…V-17) to Reels · Awareness. All passed the SEBI compliance gate.', proposedAt: '13:30', checks: [{ label: 'SEBI compliance', status: 'pass' }, { label: 'Brand lock', status: 'pass' }] },
  { id: 'a3', agent: 'Audience', agentCode: 'AU', action: 'Suppression list', summary: 'New suppression list', payload: 'Suppress 1,240 contacts who opted out in the last 24h across Meta + WhatsApp.', proposedAt: '11:15', checks: [{ label: 'Consent / DPDP', status: 'pass' }, { label: 'Hashed PII only', status: 'pass' }] },
]
export const integrationsFull: IntegrationDetail[] = [
  { id: 'i1', name: 'Meta Ads', auth: 'OAuth 2.1', status: 'healthy', scopes: ['ads_read', 'ads_management'], lastSync: '2m ago', calls: '3,412', grad: ['violet', 'sky'] },
  { id: 'i2', name: 'Google Ads', auth: 'OAuth 2.1', status: 'healthy', scopes: ['adwords'], lastSync: '1m ago', calls: '2,180', grad: ['amber', 'rose'] },
  { id: 'i3', name: 'GA4', auth: 'OAuth 2.1', status: 'healthy', scopes: ['analytics.readonly'], lastSync: '4m ago', calls: '1,024', grad: ['sky', 'emerald'] },
  { id: 'i4', name: 'WhatsApp / BSP', auth: 'API key', status: 'degraded', scopes: ['messages', 'templates'], lastSync: '18m ago', calls: '642', grad: ['emerald', 'sky'] },
  { id: 'i5', name: 'Instantly', auth: 'API key', status: 'healthy', scopes: ['campaigns', 'inbox'], lastSync: '3m ago', calls: '918', grad: ['violet', 'emerald'] },
  { id: 'i6', name: 'Mailchimp', auth: 'OAuth 2.1', status: 'healthy', scopes: ['audiences', 'campaigns'], lastSync: '6m ago', calls: '204', grad: ['amber', 'violet'] },
  { id: 'i7', name: 'n8n', auth: 'token', status: 'paused', scopes: ['workflows'], lastSync: '2h ago', calls: '0', grad: ['rose', 'amber'] },
  { id: 'i8', name: 'Segment', auth: 'API key', status: 'disconnected', scopes: [], lastSync: '—', calls: '0', grad: ['sky', 'violet'] },
]

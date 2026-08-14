export type Role = 'master' | 'agency' | 'strategist' | 'creative' | 'analyst' | 'viewer'
export type AgentTier = 'auto' | 'propose' | 'human'
export type Direction = 'up' | 'down' | 'flat'
export type SeriesColor = 'violet' | 'emerald' | 'sky' | 'amber' | 'rose'

export interface Tenant { id: string; name: string; region: string; env: string }

/**
 * A tenant a platform admin can switch into. Deliberately distinct from
 * `Tenant`: `Tenant.id` is the slug (display-only) and other code relies on
 * that meaning, but the switcher needs the real UUID to send to
 * /api/tenant/switch and compare against tenant_id in the membership table.
 * Carrying both fields explicitly (rather than overloading Tenant.id)
 * prevents the slug-vs-UUID confusion that once broke the switcher.
 */
export interface SwitchableTenant { tenantId: string; slug: string; name: string }
export interface User { id: string; name: string; email: string; role: Role; status: 'active' | 'invited' }

export interface KpiMetric { label: string; value: string; deltaLabel: string; direction: Direction; sparkline: number[]; color: SeriesColor }
export interface MetricCell { label: string; value: string; deltaLabel: string; direction: Direction }
export interface FunnelStage { label: string; value: number; display: string; widthPct: number; convLabel?: string }
export interface ChannelRow { name: string; color: SeriesColor; spend: number; checkups: number; cac: number; roas: number }
export interface CampaignRow { name: string; status: 'active' | 'review' | 'paused'; cac: number | null; pacingPct: number }

export interface Agent { code: string; name: string; role: string; tier: AgentTier; runs: string; success: string; tokens: string; cost: string; enabled: boolean; grad: [SeriesColor, SeriesColor] }
export interface GatewayBudget { provider: string; spent: number; cap: number }
export interface RoutingRow { task: string; model: string; calls: string; latency: string }
export interface ModelSplitRow { model: string; color: SeriesColor; tokens: string; pct: number }
export interface TrainingJob { model: string; type: string; status: 'running' | 'deployed' | 'queued' | 'shadow'; metric: string; progress: string }
export interface PermissionRow { capability: string; roles: Record<Role, 'yes' | 'no' | 'partial'> }
export interface IntegrationRow { name: string; auth: string; status: 'healthy' | 'degraded' | 'paused'; lastSync: string; calls: string; errors: number }
export interface ActivityEvent { agent: string; title: string; sub: string; dot: SeriesColor; latency: string; tokens: string; tag?: 'ERR' | 'REVIEW' }
export interface Flag { title: string; desc: string; on: boolean }
export interface GoalGauge { pct: number; color: SeriesColor; label: string }
export interface CreativeLeaderboardRow { code: string; grad: string; title: string; sub: string; pct: number; stat: string }
export interface AnalyticsApprovalRow { code: string; color: string; title: string; sub: string }
export interface AnalyticsPanels { heatmapRows: number[][]; goalGauges: GoalGauge[]; leaderboard: CreativeLeaderboardRow[]; approvalsPreview: AnalyticsApprovalRow[] }

export interface CampaignFull {
  id: string; name: string; channel: string; channelColor: SeriesColor
  status: 'active' | 'review' | 'paused'
  spend: number; budget: number; pacingPct: number
  results: number; cac: number | null; roas: number
  objective: string; startedAt: string
}
export interface AdGroup { id: string; name: string; status: 'active' | 'paused'; spend: number; results: number }
export interface CreativeAsset { id: string; kind: 'image' | 'video' | 'copy'; label: string; status: 'live' | 'review' | 'draft'; grad: [SeriesColor, SeriesColor] }
export interface CampaignDetail { campaign: CampaignFull; adGroups: AdGroup[]; creatives: CreativeAsset[]; series: number[] }

export type VariantKind = 'image' | 'copy'
export interface Brief { audience: string; hook: string; offer: string; format: 'image' | 'video' | 'copy' }
export interface Variant { id: string; kind: VariantKind; headline: string; body?: string; grad: [SeriesColor, SeriesColor]; compliance: 'pass' | 'flag'; flagReason?: string }

export interface PromptTemplate { id: string; title: string; body: string }
export interface Citation { label: string; source: string }
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: Citation[]
  /** Assistant only. False = no citation survived verification; the UI must say so. */
  grounded?: boolean
  /** Assistant only. The ask failed; `text` carries the human-readable reason. */
  failed?: boolean
}

export interface PolicyCheck { label: string; status: 'pass' | 'warn' }
export interface ApprovalItem { id: string; agent: string; agentCode: string; action: string; summary: string; payload: string; proposedAt: string; checks: PolicyCheck[] }

export interface IntegrationDetail {
  id: string; name: string; auth: 'OAuth 2.1' | 'API key' | 'token'
  status: 'healthy' | 'degraded' | 'paused' | 'disconnected'
  scopes: string[]; lastSync: string; calls: string; grad: [SeriesColor, SeriesColor]
}

export interface WorkspaceMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  citations?: Citation[]
  grounded?: boolean
  tokensIn?: number
  tokensOut?: number
  costMicros?: number
  createdAt: string
}

export interface WorkspaceThread {
  id: string
  tenantId: string
  userId: string
  title: string
  tag?: string | null
  isPinned: boolean
  createdAt: string
  updatedAt: string
  lastMessagePreview?: string | null
  messageCount?: number
  messages?: WorkspaceMessage[]
}

export type HopKind =
  | 'governor_plan'
  | 'analyst_findings'
  | 'creative_brief'
  | 'creative_deck'
  | 'media_package'
  | 'budget_proposal'
  | 'hitl_proposal'

export interface HandoffEnvelope {
  id?: string
  hopIndex: number
  fromAgent: string
  toAgent: string
  hopKind: HopKind | string
  runId: string
  tenantId?: string
  schemaVersion?: string
  summary: string
  payload: Record<string, unknown>
  governorRationale: string
  verdict: string
  tokensIn?: number
  tokensOut?: number
  costMicros?: number
  createdAt?: string
}


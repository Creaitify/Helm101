export type Role = 'master' | 'agency' | 'strategist' | 'creative' | 'analyst' | 'viewer'
export type AgentTier = 'auto' | 'propose' | 'human'
export type Direction = 'up' | 'down' | 'flat'
export type SeriesColor = 'violet' | 'emerald' | 'sky' | 'amber' | 'rose'

export interface Tenant { id: string; name: string; region: string; env: string }
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

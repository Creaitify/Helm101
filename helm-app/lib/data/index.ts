import * as fx from './mock/fixtures'
import type * as T from '../types'

const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for fetch() later

export const getTenant = () => delay<T.Tenant>(fx.tenant)
export const getKpis = () => delay<T.KpiMetric[]>(fx.kpis)
export const getMetricStrip = () => delay<T.MetricCell[]>(fx.metricStrip)
export const getAnalyticsPanels = () => delay<T.AnalyticsPanels>(fx.analyticsPanels)
export const getFunnel = () => delay<T.FunnelStage[]>(fx.funnel)
export const getChannels = () => delay<T.ChannelRow[]>(fx.channels)
export const getCampaigns = () => delay<T.CampaignRow[]>(fx.campaigns)
export const getActivity = () => delay<T.ActivityEvent[]>(fx.activity)
export const getAgents = () => delay<T.Agent[]>(fx.agents)
export const getGatewayBudgets = () => delay<T.GatewayBudget[]>(fx.gatewayBudgets)
export const getRouting = () => delay<T.RoutingRow[]>(fx.routing)
export const getModelSplit = () => delay<T.ModelSplitRow[]>(fx.modelSplit)
export const getTrainingJobs = () => delay<T.TrainingJob[]>(fx.trainingJobs)
export const getPermissions = () => delay<T.PermissionRow[]>(fx.permissions)
export const getUsers = () => delay<T.User[]>(fx.users)
export const getIntegrations = () => delay<T.IntegrationRow[]>(fx.integrations)
export const getGuardrails = () => delay<T.Flag[]>(fx.guardrails)
export const getFeatureFlags = () => delay<T.Flag[]>(fx.featureFlags)

export const getCampaignsFull = () => delay<T.CampaignFull[]>(fx.campaignsFull)
export const getCampaignDetail = (id: string) => delay<T.CampaignDetail>(fx.campaignDetail(id))
export const getBriefDefaults = () => delay<T.Brief>(fx.briefDefaults)
export const getPromptTemplates = () => delay<T.PromptTemplate[]>(fx.promptTemplates)
export const getApprovals = () => delay<T.ApprovalItem[]>(fx.approvals)
export const getIntegrationsFull = () => delay<T.IntegrationDetail[]>(fx.integrationsFull)

// getCurrentTenantValue is NOT exported from this barrel (see ./tenant-value.ts
// for why): this file is imported by client components (e.g.
// CampaignsView.tsx via `@/lib/data`), and even a type-only re-export here
// pulls the whole module graph -- including tenant-session's next-auth /
// next/headers / @neondatabase/serverless imports -- into the client bundle,
// which fails `next build` ("'server-only' cannot be imported from a Client
// Component module"). Import getCurrentTenantValue from '@/lib/data/tenant-value'
// directly; this is a deliberate deviation from the brief's `from '@/lib/data'`
// import path, required to keep the existing client-imported barrel intact.

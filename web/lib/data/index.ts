import 'server-only'
import * as fx from './mock/fixtures'
import type * as T from '../types'

/**
 * The data seam for every UI surface.
 *
 * helm-api has no domain endpoints yet (only /api/v1/tenants and health), so
 * every getter serves fixtures unconditionally -- in demo mode AND live mode.
 * There is deliberately no live/demo branch here: it would be a branch to
 * nowhere. When a FastAPI endpoint lands, its getter swaps `delay(fixture)`
 * for a helm-api-client call at the marked seam; the Phase A fallback ladder
 * (Neon reads with fixture fallbacks) is gone for good -- see
 * docs/PENDING.md.
 */
const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for helmApiGet in phase 2

export const getKpis = () => delay<T.KpiMetric[]>(fx.kpis)
export const getMetricStrip = () => delay<T.MetricCell[]>(fx.metricStrip)
export const getAnalyticsPanels = () => delay<T.AnalyticsPanels>(fx.analyticsPanels)
export const getFunnel = () => delay<T.FunnelStage[]>(fx.funnel)
export const getChannels = () => delay<T.ChannelRow[]>(fx.channels)
export const getActivity = () => delay<T.ActivityEvent[]>(fx.activity)
export const getAgents = () => delay<T.Agent[]>(fx.agents)
export const getGatewayBudgets = () => delay<T.GatewayBudget[]>(fx.gatewayBudgets)
export const getRouting = () => delay<T.RoutingRow[]>(fx.routing)
export const getModelSplit = () => delay<T.ModelSplitRow[]>(fx.modelSplit)
export const getTrainingJobs = () => delay<T.TrainingJob[]>(fx.trainingJobs)
export const getPermissions = () => delay<T.PermissionRow[]>(fx.permissions)
export const getGuardrails = () => delay<T.Flag[]>(fx.guardrails)
export const getFeatureFlags = () => delay<T.Flag[]>(fx.featureFlags)
export const getBriefDefaults = () => delay<T.Brief>(fx.briefDefaults)
export const getIntegrations = () => delay<T.IntegrationRow[]>(fx.integrations)

// --- Formerly Phase A DB reads; fixtures until the FastAPI endpoints exist. ---

// TODO(phase-2): GET /api/v1/users
export const getUsers = () => delay<T.User[]>(fx.users)

// TODO(phase-2): GET /api/v1/campaigns
export const getCampaignsFull = () => delay<T.CampaignFull[]>(fx.campaignsFull)

/**
 * Returns null (never fabricated data) when the id names no known campaign.
 * fetchCampaignDetail is a 'use server' action -- a network endpoint -- so the
 * id is attacker-controlled regardless of what the UI sends, and
 * fx.campaignDetail(id) fabricates a populated detail for ANY unknown id; the
 * existence check must stay on this side of that call.
 */
// TODO(phase-2): GET /api/v1/campaigns/{id}
export const getCampaignDetail = (id: string): Promise<T.CampaignDetail | null> =>
  delay(fx.campaignsFull.some((c) => c.id === id) ? fx.campaignDetail(id) : null)

// TODO(phase-2): GET /api/v1/approvals
export const getApprovals = () => delay<T.ApprovalItem[]>(fx.approvals)

// TODO(phase-2): GET /api/v1/prompt-templates
export const getPromptTemplates = () => delay<T.PromptTemplate[]>(fx.promptTemplates)

// TODO(phase-2): GET /api/v1/integrations
export const getIntegrationsFull = () => delay<T.IntegrationDetail[]>(fx.integrationsFull)

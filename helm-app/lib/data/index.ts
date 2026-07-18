import * as fx from './mock/fixtures'
import type * as T from '../types'

const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for fetch() later

export const getTenant = () => delay<T.Tenant>(fx.tenant)
export const getKpis = () => delay<T.KpiMetric[]>(fx.kpis)
export const getMetricStrip = () => delay<T.MetricCell[]>(fx.metricStrip)
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

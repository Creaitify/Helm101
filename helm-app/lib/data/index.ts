import * as fx from './mock/fixtures'
import type * as T from '../types'
import type { TenantValue } from '../tenant'

const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for fetch() later

/**
 * True for the two conditions that legitimately mean "no database here":
 * an unconfigured/unreachable Neon connection, and an unauthenticated or
 * unprovisioned caller. Anything else is a real bug and must stay visible.
 */
export function isExpectedFallback(error: unknown): boolean {
  const name = error instanceof Error ? error.constructor.name : ''
  if (name === 'UnauthenticatedError' || name === 'NoMembershipError') return true
  const message = error instanceof Error ? error.message : ''
  return /Missing required server environment variable|ECONNREFUSED|ENOTFOUND|password authentication failed/i.test(message)
}

/**
 * Runs a repository read under tenant RLS, falling back to fixtures when no
 * database is configured or the caller has no session. The fallback is what
 * keeps tests and local development working without Neon.
 *
 * A genuine query bug must never be silently indistinguishable from "no
 * database": unexpected errors are logged, and in production they throw.
 */
async function read<V>(work: (tx: import('../server/tenant-context').TenantQueryTransaction) => Promise<V>, fallback: V): Promise<V> {
  if (!process.env.NEON_DATABASE_URL) return fallback
  try {
    const { requireTenantContext } = await import('../server/tenant-session')
    const { withTenantContext } = await import('../server/db')
    const context = await requireTenantContext()
    return await withTenantContext(context, work)
  } catch (error) {
    if (isExpectedFallback(error)) return fallback
    console.error('[data] repository read failed, serving fixtures', error)
    if (process.env.HELM_ENV === 'production') throw error
    return fallback
  }
}

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
export const getGuardrails = () => delay<T.Flag[]>(fx.guardrails)
export const getFeatureFlags = () => delay<T.Flag[]>(fx.featureFlags)
export const getBriefDefaults = () => delay<T.Brief>(fx.briefDefaults)

// --- Cut over to the database, one aggregate at a time. ---

export const getUsers = async (): Promise<T.User[]> => {
  const { listUsers } = await import('../repositories/directory')
  return read((tx) => listUsers(tx), fx.users)
}

export const getCampaignsFull = async (): Promise<T.CampaignFull[]> => {
  const { listCampaigns } = await import('../repositories/campaigns')
  return read((tx) => listCampaigns(tx), fx.campaignsFull)
}

export const getCampaignDetail = async (id: string): Promise<T.CampaignDetail> => {
  const { getCampaignDetailRow } = await import('../repositories/campaigns')
  return read(async (tx) => (await getCampaignDetailRow(tx, id)) ?? fx.campaignDetail(id), fx.campaignDetail(id))
}

export const getApprovals = async (): Promise<T.ApprovalItem[]> => {
  const { listApprovals } = await import('../repositories/approvals')
  return read((tx) => listApprovals(tx), fx.approvals)
}

export const getPromptTemplates = async (): Promise<T.PromptTemplate[]> => {
  const { listPromptTemplates } = await import('../repositories/conversations')
  return read((tx) => listPromptTemplates(tx), fx.promptTemplates)
}

export const getIntegrations = () => delay<T.IntegrationRow[]>(fx.integrations)

export const getIntegrationsFull = async (): Promise<T.IntegrationDetail[]> => {
  const { listIntegrations } = await import('../repositories/directory')
  return read((tx) => listIntegrations(tx), fx.integrationsFull)
}

/**
 * Decides a pending approval (approve/reject) under tenant RLS and appends
 * the audit event, via repositories/approvals.ts's decideApproval. Requires
 * a live database and an authenticated tenant context -- there is no
 * fixture-backed fallback for a write, since fixtures have nothing to
 * durably mutate. Callers (a future 'use server' action, per Task 13's
 * optimistic-UI note in approvals.ts) must expect this to throw when no
 * database is configured or the caller is unauthenticated.
 */
export const decideApprovalAction = async (
  externalRef: string,
  decision: 'approved' | 'rejected',
): Promise<void> => {
  const { decideApproval } = await import('../repositories/approvals')
  const { requireTenantContext } = await import('../server/tenant-session')
  const { withTenantContext } = await import('../server/db')
  const context = await requireTenantContext()
  await withTenantContext(context, (tx) => decideApproval(tx, context, { externalRef, decision }))
}

/**
 * Server-side seam for lib/tenant.tsx's TenantProvider. Resolves the
 * caller's real membership (via requireTenantContext, Task 8) and the tenant
 * row it points at (via getTenantById, Task 7), then maps the DB role to the
 * UI role vocabulary (toUiRole, Task 2).
 *
 * Returns undefined -- letting TenantProvider fall back to its Finnovate
 * default -- for the same two "no database here" conditions read() swallows:
 * no NEON_DATABASE_URL configured, or an unauthenticated/unprovisioned
 * caller. Any other error is logged and, in production, rethrown, for the
 * same reason read() does: a genuine query bug must not look like "no
 * database configured".
 */
export const getCurrentTenantValue = async (): Promise<TenantValue | undefined> => {
  if (!process.env.NEON_DATABASE_URL) return undefined
  try {
    const { requireTenantContext } = await import('../server/tenant-session')
    const { withTenantContext } = await import('../server/db')
    const { getTenantById } = await import('../repositories/directory')
    const { toUiRole } = await import('../server/role-mapping')
    const context = await requireTenantContext()
    return await withTenantContext(context, async (tx) => {
      const tenant = await getTenantById(tx, context.tenantId)
      if (!tenant) return undefined
      return { tenant, role: toUiRole(context.role) }
    })
  } catch (error) {
    if (isExpectedFallback(error)) return undefined
    console.error('[data] tenant value read failed', error)
    if (process.env.HELM_ENV === 'production') throw error
    return undefined
  }
}

import 'server-only'
import * as fx from './mock/fixtures'
import type * as T from '../types'
import type { TenantValue } from '../tenant'
import { env } from '../server/env'
import { UnauthenticatedError, NoMembershipError } from '../server/tenant-session'
import { RlsBypassError } from '../server/db'

const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for fetch() later

/**
 * True in production under EITHER signal: the normalized (trimmed) HELM_ENV
 * from lib/server/env.ts, or NODE_ENV=production, which Next sets
 * automatically on every production build with no operator action required.
 * Relying on HELM_ENV alone left the re-throw dead code in every real
 * deployment, since nothing ever set it.
 */
function isProduction(): boolean {
  return env.appEnv === 'production' || process.env.NODE_ENV === 'production'
}

/**
 * True for Next.js's own internal control-flow signals -- thrown through
 * ordinary try/catch during static prerendering (DYNAMIC_SERVER_USAGE) or a
 * redirect (NEXT_REDIRECT) -- which must be re-thrown untouched before any
 * other classification. They are not "expected fallback" conditions and must
 * not be logged as unexpected bugs either: swallowing them breaks Next's
 * routing/prerendering machinery.
 */
export function isNextControlFlowSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest
  if (typeof digest !== 'string') return false
  return digest === 'DYNAMIC_SERVER_USAGE' || digest.startsWith('NEXT_REDIRECT')
}

/**
 * True for the two conditions that legitimately mean "no database here":
 * an unconfigured/unreachable Neon connection (by Node socket error code,
 * not message text -- Postgres error messages can embed offending row
 * values, so message-substring matching risks misclassifying a genuine SQL
 * error), and an unauthenticated or unprovisioned caller (by instanceof
 * against the real exported error classes, not constructor.name, which any
 * unrelated same-named class would satisfy). Anything else is a real bug and
 * must stay visible.
 */
export function isExpectedFallback(error: unknown): boolean {
  if (isNextControlFlowSignal(error)) return false
  if (error instanceof UnauthenticatedError || error instanceof NoMembershipError) return true
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return true
  const message = error instanceof Error ? error.message : ''
  return /^Missing required server environment variable/.test(message)
}

/**
 * Runs a repository read under tenant RLS, falling back to fixtures when no
 * database is configured or the caller has no session. The fallback is what
 * keeps tests and local development working without Neon.
 *
 * A genuine query bug must never be silently indistinguishable from "no
 * database": unexpected errors are logged, and in production they throw.
 * Next's own control-flow signals (DYNAMIC_SERVER_USAGE, NEXT_REDIRECT) are
 * re-thrown untouched before any other classification. An RlsBypassError
 * (misconfigured database role) always re-throws, in every environment --
 * never falls back to fixtures.
 */
async function read<V>(work: (tx: import('../server/tenant-context').TenantQueryTransaction) => Promise<V>, fallback: V): Promise<V> {
  if (!process.env.NEON_DATABASE_URL) return fallback
  try {
    const { requireTenantContext } = await import('../server/tenant-session')
    const { withTenantContext } = await import('../server/db')
    const context = await requireTenantContext()
    return await withTenantContext(context, work)
  } catch (error) {
    if (isNextControlFlowSignal(error)) throw error
    if (error instanceof RlsBypassError) throw error
    if (isExpectedFallback(error)) return fallback
    console.error('[data] repository read failed, serving fixtures', error)
    if (isProduction()) throw error
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

/**
 * Returns null (never fabricated fixture data) when the id does not resolve
 * to a row this tenant can see -- whether because RLS correctly hid another
 * tenant's campaign, or the id is simply unknown. The OUTER fallback
 * argument to read() is the only legitimate "no database configured/no
 * session" path; the inner repository result is never coerced to a fixture,
 * since fetchCampaignDetail is a 'use server' action (a network endpoint)
 * and the id is attacker-controlled regardless of what the UI sends.
 */
export const getCampaignDetail = async (id: string): Promise<T.CampaignDetail | null> => {
  const { getCampaignDetailRow } = await import('../repositories/campaigns')
  return read((tx) => getCampaignDetailRow(tx, id), fx.campaignDetail(id))
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
    if (isNextControlFlowSignal(error)) throw error
    if (error instanceof RlsBypassError) throw error
    if (isExpectedFallback(error)) return undefined
    console.error('[data] tenant value read failed', error)
    if (isProduction()) throw error
    return undefined
  }
}

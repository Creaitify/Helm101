import { redirect } from 'next/navigation'
import { TenantProvider, type TenantValue } from '@/lib/tenant'
import { ApprovalsProvider } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/shell/AppShell'
import { NoMembershipError, UnauthenticatedError, resolveTenantSession } from '@/lib/server/tenant-session'
import { withTenantContext } from '@/lib/server/db'
import { getTenantById, listSwitchableTenants } from '@/lib/repositories/directory'
import { toUiRole } from '@/lib/server/role-mapping'
import type { SwitchableTenant } from '@/lib/types'

/**
 * Resolves the session exactly once (resolveTenantSession: one
 * getServerSession + one resolveMembership call) and, in the SAME
 * transaction, reads everything both the tenant shell and the admin-only
 * tenant switcher need. Previously this layout called getCurrentTenantValue()
 * and a local getSwitcherProps() independently, each re-doing
 * getServerSession + resolveMembership + requireTenantContext from scratch --
 * three extra round trips per request, and a window where the two calls
 * could observe different membership state (e.g. a switch landing between
 * them). A missing NEON_DATABASE_URL still falls back to the shell's default
 * (Finnovate/master) so local dev without a live Neon connection keeps
 * working; only a platform admin ever gets a non-empty switcher list (see
 * the forged-cookie defense in lib/server/tenant-session.ts) -- showing the
 * control to anyone else would only invite a confusing no-op click.
 */
async function loadShellData(): Promise<{ value?: TenantValue; switcher: { tenants?: SwitchableTenant[]; activeId?: string } }> {
  if (!process.env.NEON_DATABASE_URL) return { switcher: {} }
  const { context, membership } = await resolveTenantSession()
  return withTenantContext(context, async (tx) => {
    const tenant = await getTenantById(tx, context.tenantId)
    const value: TenantValue | undefined = tenant ? { tenant, role: toUiRole(context.role) } : undefined
    if (!membership.isPlatformAdmin) return { value, switcher: {} }
    const tenants = await listSwitchableTenants(tx)
    // activeId is the real UUID (context.tenantId), matching each option's
    // value in TenantSwitcher -- NOT tenant?.id, which is the slug.
    return { value, switcher: { tenants, activeId: context.tenantId } }
  })
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let value: TenantValue | undefined
  let switcher: { tenants?: SwitchableTenant[]; activeId?: string } = {}
  try {
    const loaded = await loadShellData()
    value = loaded.value
    switcher = loaded.switcher
  } catch (error) {
    // Task 9 built /no-access but nothing routed to it yet; this is that
    // route. Middleware already keeps a fully unauthenticated request from
    // reaching this layout, so UnauthenticatedError here would indicate the
    // session expired mid-request -- send it through /login same as before.
    if (error instanceof NoMembershipError) redirect('/no-access')
    if (error instanceof UnauthenticatedError) redirect('/login')
    throw error
  }
  return (
    <TenantProvider value={value}>
      <ApprovalsProvider>
        <ToastProvider>
          <AppShell switchableTenants={switcher.tenants} activeTenantId={switcher.activeId}>
            {children}
          </AppShell>
        </ToastProvider>
      </ApprovalsProvider>
    </TenantProvider>
  )
}

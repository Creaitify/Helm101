import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { TenantProvider, type TenantValue } from '@/lib/tenant'
import { ApprovalsProvider } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/shell/AppShell'
import { getCurrentTenantValue } from '@/lib/data/tenant-value'
import { authOptions } from '@/auth'
import { NoMembershipError, UnauthenticatedError, resolveMembership, requireTenantContext } from '@/lib/server/tenant-session'
import { withTenantContext } from '@/lib/server/db'
import { getTenantById, listSwitchableTenants } from '@/lib/repositories/directory'
import type { Tenant } from '@/lib/types'

/**
 * Only a platform admin ever sees a non-empty list: resolveMembership
 * already refuses to honour a switch request from anyone else (see the
 * forged-cookie defense in lib/server/tenant-session.ts), so showing the
 * control to a non-admin would only invite a confusing no-op click.
 * Kept local to this layout rather than added to lib/data's public surface,
 * since it has exactly one caller.
 */
async function getSwitcherProps(): Promise<{ tenants?: Tenant[]; activeId?: string }> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return {}
  const membership = await resolveMembership(email)
  if (!membership?.isPlatformAdmin) return {}
  const context = await requireTenantContext()
  const [tenants, activeTenant] = await withTenantContext(context, async (tx) => [
    await listSwitchableTenants(tx),
    await getTenantById(tx, context.tenantId),
  ] as const)
  return { tenants, activeId: activeTenant?.id }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let value: TenantValue | undefined
  let switcher: { tenants?: Tenant[]; activeId?: string } = {}
  try {
    value = await getCurrentTenantValue()
    if (value) switcher = await getSwitcherProps()
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

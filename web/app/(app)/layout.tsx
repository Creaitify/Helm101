import { redirect } from 'next/navigation'
import { TenantProvider, type TenantValue } from '@/lib/tenant'
import { ApprovalsProvider } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/shell/AppShell'
import { loadShellData, NoMembershipError } from '@/lib/server/shell-data'
import { isDemoMode } from '@/lib/server/env'
import { UnauthenticatedError } from '@/lib/server/tenant-directory'
import { HelmApiError } from '@/lib/server/helm-api-errors'
import type { SwitchableTenant } from '@/lib/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let value: TenantValue | undefined
  let switcher: { tenants?: SwitchableTenant[]; activeId?: string } = {}
  try {
    ;({ value, switcher } = await loadShellData())
  } catch (error) {
    if (error instanceof NoMembershipError) redirect('/no-access')
    // Middleware keeps a fully unauthenticated request from reaching this
    // layout; UnauthenticatedError here means the session expired mid-request.
    if (error instanceof UnauthenticatedError) redirect('/login')
    if (error instanceof HelmApiError && error.code === 'tenant_context_required') {
      // TODO(phase-2): GET /tenants should not itself demand a tenant context;
      // until helm-api resolves the discovery chicken-and-egg, a hint-less
      // multi-membership caller lands here rather than on a broken shell.
      redirect('/no-access')
    }
    // Genuine outage (upstream_unreachable etc.) -> error boundary. Never
    // rendered as "no access": a backend outage must not look like revocation.
    throw error
  }
  return (
    <TenantProvider value={value}>
      <ApprovalsProvider>
        <ToastProvider>
          <AppShell
            switchableTenants={switcher.tenants}
            activeTenantId={switcher.activeId}
            dataMode={isDemoMode() ? 'demo' : 'live'}
          >
            {children}
          </AppShell>
        </ToastProvider>
      </ApprovalsProvider>
    </TenantProvider>
  )
}

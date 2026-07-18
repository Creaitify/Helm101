import { TenantProvider } from '@/lib/tenant'
import { ApprovalsProvider } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/shell/AppShell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantProvider>
      <ApprovalsProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </ApprovalsProvider>
    </TenantProvider>
  )
}

import { TenantProvider } from '@/lib/tenant'
import { AppShell } from '@/components/shell/AppShell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantProvider>
      <AppShell>{children}</AppShell>
    </TenantProvider>
  )
}

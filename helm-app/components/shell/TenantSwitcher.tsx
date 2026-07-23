'use client'
import { useRouter } from 'next/navigation'
import type { Tenant } from '@/lib/types'

export function TenantSwitcher({ tenants, activeId }: { tenants: Tenant[]; activeId: string }) {
  const router = useRouter()
  if (tenants.length <= 1) return null

  return (
    <select
      className="tenant-switcher"
      aria-label="Active workspace"
      value={activeId}
      onChange={async (event) => {
        await fetch('/api/tenant/switch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: event.target.value }),
        })
        router.refresh()
      }}
    >
      {tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
      ))}
    </select>
  )
}

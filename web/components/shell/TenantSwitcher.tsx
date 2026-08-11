'use client'
import { useRouter } from 'next/navigation'
import type { SwitchableTenant } from '@/lib/types'

/**
 * `activeId` and each option's `value` are the tenant's real UUID
 * (`SwitchableTenant.tenantId`), NOT the slug. `Tenant.id` (lib/types.ts) is
 * the slug and is display-only elsewhere in the app; using it here would
 * POST a slug to /api/tenant/switch, which stores it in a cookie compared
 * against a `uuid` column -- see the fix history on this component for the
 * lockout that caused.
 */
export function TenantSwitcher({ tenants, activeId }: { tenants: SwitchableTenant[]; activeId: string }) {
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
        <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.name}</option>
      ))}
    </select>
  )
}

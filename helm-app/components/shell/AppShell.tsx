'use client'
import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useTenant } from '@/lib/tenant'
import type { Tenant } from '@/lib/types'

export function AppShell({
  children,
  switchableTenants,
  activeTenantId,
}: {
  children: React.ReactNode
  /** Present only for a platform admin with more than one switchable tenant. */
  switchableTenants?: Tenant[]
  activeTenantId?: string
}) {
  const { role } = useTenant()
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="app">
      <Sidebar role={role} open={navOpen} onNavigate={() => setNavOpen(false)} />
      <div className="main">
        <TopBar onMenu={() => setNavOpen(true)} tenants={switchableTenants} activeId={activeTenantId} />
        {children}
      </div>
    </div>
  )
}

'use client'
import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ProvenanceBanner } from './ProvenanceBanner'
import { useTenant } from '@/lib/tenant'
import type { SwitchableTenant } from '@/lib/types'

export function AppShell({
  children,
  switchableTenants,
  activeTenantId,
  dataMode,
}: {
  children: React.ReactNode
  /** Present only for a platform admin with more than one switchable tenant. */
  switchableTenants?: SwitchableTenant[]
  activeTenantId?: string
  /** Which provenance banner to show. The app layout always passes one;
   *  omitted only by tests that render the shell in isolation. */
  dataMode?: 'demo' | 'live'
}) {
  const { role } = useTenant()
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="app">
      <Sidebar role={role} open={navOpen} onNavigate={() => setNavOpen(false)} />
      <div className="main">
        {dataMode && <ProvenanceBanner mode={dataMode} />}
        <TopBar onMenu={() => setNavOpen(true)} tenants={switchableTenants} activeId={activeTenantId} />
        {children}
      </div>
    </div>
  )
}

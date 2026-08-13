'use client'
import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ProvenanceBanner } from './ProvenanceBanner'
import { CommandPalette } from './CommandPalette'
import { NewCampaignSlideOver } from './NewCampaignSlideOver'
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [newCampOpen, setNewCampOpen] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('helm:sidebar-collapsed')
      if (saved === 'true') setSidebarCollapsed(true)
    } catch {}

    function handleOpenCmd() {
      setCmdOpen(true)
    }
    function handleOpenNewCamp() {
      setNewCampOpen(true)
    }

    window.addEventListener('helm:open-cmd-palette', handleOpenCmd)
    window.addEventListener('helm:open-new-campaign', handleOpenNewCamp)

    return () => {
      window.removeEventListener('helm:open-cmd-palette', handleOpenCmd)
      window.removeEventListener('helm:open-new-campaign', handleOpenNewCamp)
    }
  }, [])

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('helm:sidebar-collapsed', String(next))
      } catch {}
      return next
    })
  }

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        role={role}
        open={navOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
        onNavigate={() => setNavOpen(false)}
      />
      <div className="main">
        {dataMode && <ProvenanceBanner mode={dataMode} />}
        <TopBar
          onMenu={() => setNavOpen(true)}
          tenants={switchableTenants}
          activeId={activeTenantId}
          onOpenCmd={() => setCmdOpen(true)}
          onOpenNewCampaign={() => setNewCampOpen(true)}
        />
        {children}
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <NewCampaignSlideOver open={newCampOpen} onClose={() => setNewCampOpen(false)} />
    </div>
  )
}

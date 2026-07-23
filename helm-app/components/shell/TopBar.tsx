'use client'
import { Search, Bell, Moon, Plus, Menu } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/Button'
import { TenantSwitcher } from '@/components/shell/TenantSwitcher'
import type { SwitchableTenant } from '@/lib/types'

export function TopBar({
  onMenu = () => {},
  tenants,
  activeId,
}: {
  onMenu?: () => void
  /** Omitted (not just empty) for callers that render TopBar with no tenant
   *  data, e.g. existing tests -- so TenantSwitcher, which unconditionally
   *  calls useRouter(), is never mounted for them. */
  tenants?: SwitchableTenant[]
  activeId?: string
}) {
  const { toggle } = useTheme()
  return (
    <header className="top">
      <button className="ibtn menu-btn" aria-label="Open navigation" onClick={onMenu}><Menu /></button>
      <div className="search">
        <Search width={14} height={14} />
        Search campaigns, agents, creatives, leads…
        <span className="kbd">Ctrl K</span>
      </div>
      <div className="spacer" />
      {tenants && activeId !== undefined && <TenantSwitcher tenants={tenants} activeId={activeId} />}
      <div className="live">
        <span className="p" />
        LIVE · 3 agents active
      </div>
      <button className="ibtn" aria-label="Toggle theme" onClick={toggle}>
        <Moon />
      </button>
      <button className="ibtn" aria-label="Notifications">
        <Bell />
      </button>
      <Button variant="primary">
        <Plus width={14} height={14} />
        New Campaign
      </Button>
    </header>
  )
}

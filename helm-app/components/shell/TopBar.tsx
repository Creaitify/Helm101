'use client'
import { Search, Bell, Moon, Plus } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/Button'

export function TopBar() {
  const { toggle } = useTheme()
  return (
    <header className="top">
      <div className="search">
        <Search width={14} height={14} />
        Search campaigns, agents, creatives, leads…
        <span className="kbd">Ctrl K</span>
      </div>
      <div className="spacer" />
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

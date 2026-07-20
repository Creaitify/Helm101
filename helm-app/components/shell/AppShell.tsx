'use client'
import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useTenant } from '@/lib/tenant'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role } = useTenant()
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="app">
      <Sidebar role={role} open={navOpen} onNavigate={() => setNavOpen(false)} />
      <div className="main">
        <TopBar onMenu={() => setNavOpen(true)} />
        {children}
      </div>
    </div>
  )
}

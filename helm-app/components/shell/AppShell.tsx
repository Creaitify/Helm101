'use client'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useTenant } from '@/lib/tenant'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role } = useTenant()
  return (
    <div className="app">
      <Sidebar role={role} />
      <div className="main">
        <TopBar />
        {children}
      </div>
    </div>
  )
}

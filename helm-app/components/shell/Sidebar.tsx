'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  LineChart,
  Image,
  MessageSquare,
  Plug,
  CheckCircle,
  Bot,
  Globe,
  GraduationCap,
  Users,
  Settings,
  ChevronDown,
} from 'lucide-react'
import { NAV } from '@/lib/nav'
import { can } from '@/lib/rbac'
import type { Role } from '@/lib/types'
import { useTenant } from '@/lib/tenant'
import { useApprovals } from '@/lib/approvals'

const ICONS = {
  LayoutDashboard,
  LineChart,
  Image,
  MessageSquare,
  Plug,
  CheckCircle,
  Bot,
  Globe,
  GraduationCap,
  Users,
  Settings,
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  const { tenant } = useTenant()
  const { pending } = useApprovals()
  const visible = NAV.filter((it) => !it.cap || can(role, it.cap))
  const operate = visible.filter((it) => it.section === 'operate')
  const master = visible.filter((it) => it.section === 'master')

  return (
    <aside className="side">
      <div className="brand">
        <span className="mark">H</span>
        <div>
          <b>HELM</b>
          <small>CONTROL PLANE</small>
        </div>
      </div>
      <div className="wsw">
        <span className="d">{tenant.name.charAt(0)}</span>
        <div className="t">
          <b>{tenant.name}</b>
          <span>{tenant.region} · {tenant.env}</span>
        </div>
        <ChevronDown />
      </div>
      <div className="role-chip">
        <span className="k" />
        MASTER ADMIN · root
      </div>

      <div className="nlabel">Operate</div>
      <nav className="nav">
        {operate.map((it) => {
          const Icon = ICONS[it.icon as keyof typeof ICONS]
          const href = '/' + it.page
          const badge = it.page === 'approvals' ? pending : it.badge
          return (
            <Link key={it.page} href={href} className={pathname === href ? 'active' : undefined}>
              <Icon />
              {it.label}
              {badge ? <span className="badge">{badge}</span> : null}
            </Link>
          )
        })}
      </nav>

      {master.length > 0 && (
        <>
          <div className="nlabel">Master Console</div>
          <nav className="nav">
            {master.map((it) => {
              const Icon = ICONS[it.icon as keyof typeof ICONS]
              const href = '/' + it.page
              return (
                <Link key={it.page} href={href} className={pathname === href ? 'active' : undefined}>
                  <Icon />
                  {it.label}
                  {it.badge != null && <span className="badge">{it.badge}</span>}
                </Link>
              )
            })}
          </nav>
        </>
      )}

      <div className="user">
        <span className="av">AN</span>
        <div className="t">
          <b>Aniket</b>
          <span>root@letstute</span>
        </div>
      </div>
    </aside>
  )
}

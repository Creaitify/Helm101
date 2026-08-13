'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  LineChart,
  Image as ImageIcon,
  MessageSquare,
  Plug,
  CheckCircle,
  Bot,
  Globe,
  GraduationCap,
  Users,
  Settings,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { NAV } from '@/lib/nav'
import { can } from '@/lib/rbac'
import type { Role } from '@/lib/types'
import { useTenant } from '@/lib/tenant'
import { useApprovals } from '@/lib/approvals'

const ICONS = {
  LayoutDashboard,
  LineChart,
  Image: ImageIcon,
  MessageSquare,
  Plug,
  CheckCircle,
  Bot,
  Globe,
  GraduationCap,
  Users,
  Settings,
}

export function Sidebar({
  role,
  open = false,
  collapsed = false,
  onToggleCollapse,
  onNavigate = () => {},
}: {
  role: Role
  open?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const { tenant } = useTenant()
  const { pending } = useApprovals()
  const visible = NAV.filter((it) => !it.cap || can(role, it.cap))
  const operate = visible.filter((it) => it.section === 'operate')
  const master = visible.filter((it) => it.section === 'master')

  return (
    <aside className={`side${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <span className="mark">H</span>
        <div className="brand-text">
          <b>HELM</b>
          <small>CONTROL PLANE</small>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Maximize sidebar' : 'Minimize sidebar'}
            title={collapsed ? 'Maximize sidebar (Expand)' : 'Minimize sidebar (Collapse)'}
          >
            {collapsed ? <PanelLeft width={15} height={15} /> : <PanelLeftClose width={15} height={15} />}
          </button>
        )}
      </div>

      <div className="wsw" title={`${tenant.name} (${tenant.region} · ${tenant.env})`}>
        <span className="d">{tenant.name.charAt(0)}</span>
        <div className="t">
          <b>{tenant.name}</b>
          <span>{tenant.region} · {tenant.env}</span>
        </div>
        <ChevronDown />
      </div>

      <div className="role-chip" title="Active Role: Master Admin (root access)">
        <span className="k" />
        <span className="role-chip-text">MASTER ADMIN · root</span>
      </div>

      <div className="nlabel">Operate</div>
      <nav className="nav">
        {operate.map((it) => {
          const Icon = ICONS[it.icon as keyof typeof ICONS]
          const href = '/' + it.page
          const badge = it.page === 'approvals' ? pending : it.badge
          return (
            <Link
              key={it.page}
              href={href}
              onClick={onNavigate}
              className={pathname === href ? 'active' : undefined}
              aria-label={it.label}
              title={it.desc}
            >
              <Icon />
              <span className="nav-label">{it.label}</span>
              {badge ? <span className="badge">{badge}</span> : null}

              {/* Interactive Tooltip on Hover (Collapsed Rail Only) */}
              <div className="nav-hovercard" role="tooltip">
                <div className="nav-hovercard-desc">{it.desc}</div>
                {badge ? (
                  <div className="nav-hovercard-badge">{badge} pending checkpoint(s)</div>
                ) : null}
              </div>
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
                <Link
                  key={it.page}
                  href={href}
                  onClick={onNavigate}
                  className={pathname === href ? 'active' : undefined}
                  aria-label={it.label}
                  title={it.desc}
                >
                  <Icon />
                  <span className="nav-label">{it.label}</span>
                  {it.badge != null && <span className="badge">{it.badge}</span>}

                  {/* Interactive Tooltip on Hover (Collapsed Rail Only) */}
                  <div className="nav-hovercard" role="tooltip">
                    <div className="nav-hovercard-desc">{it.desc}</div>
                  </div>
                </Link>
              )
            })}
          </nav>
        </>
      )}

      <div className="user" title="Aniket (root@letstute)">
        <span className="av">AN</span>
        <div className="t">
          <b>Aniket</b>
          <span>root@letstute</span>
        </div>
      </div>
    </aside>
  )
}

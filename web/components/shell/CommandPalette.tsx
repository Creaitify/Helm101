'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  LayoutDashboard,
  LineChart,
  Image as ImageIcon,
  MessageSquare,
  Plug,
  CheckCircle,
  Bot,
  Globe,
  Settings,
  Shield,
  Zap,
  Moon,
  Plus,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { useTheme } from '@/lib/theme'

interface CommandItem {
  id: string
  title: string
  subtitle: string
  group: 'Navigation' | 'Agent Fleet' | 'Quick Actions'
  icon: any
  badge?: string
  action: () => void
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const { toggle } = useTheme()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items: CommandItem[] = [
    // Navigation
    {
      id: 'nav-analytics',
      title: 'Performance Overview',
      subtitle: 'Full-funnel campaign intelligence & KPI metrics',
      group: 'Navigation',
      icon: LineChart,
      badge: 'Page',
      action: () => { router.push('/analytics'); onClose(); },
    },
    {
      id: 'nav-campaigns',
      title: 'Campaign Manager',
      subtitle: 'Channel spend, allocations & active ad sets',
      group: 'Navigation',
      icon: LayoutDashboard,
      badge: 'Page',
      action: () => { router.push('/campaigns'); onClose(); },
    },
    {
      id: 'nav-studio',
      title: 'Creative Studio',
      subtitle: 'Ad copy generation & SEBI compliance gates',
      group: 'Navigation',
      icon: ImageIcon,
      badge: 'Page',
      action: () => { router.push('/studio'); onClose(); },
    },
    {
      id: 'nav-workspace',
      title: 'Grounded Workspace',
      subtitle: 'Ask Analyst with verified citations & doc search',
      group: 'Navigation',
      icon: MessageSquare,
      badge: 'Page',
      action: () => { router.push('/workspace'); onClose(); },
    },
    {
      id: 'nav-approvals',
      title: 'Approvals Inbox',
      subtitle: 'Human-in-the-loop checkpoint decisions',
      group: 'Navigation',
      icon: CheckCircle,
      badge: 'Page',
      action: () => { router.push('/approvals'); onClose(); },
    },
    {
      id: 'nav-agents',
      title: 'Agent Fleet Console',
      subtitle: 'Supervise Governor, Media Buyer, Creative & Analyst',
      group: 'Navigation',
      icon: Bot,
      badge: 'Page',
      action: () => { router.push('/agents'); onClose(); },
    },
    {
      id: 'nav-integrations',
      title: 'Integrations & Connectors',
      subtitle: 'Meta Ads, Google Ads, WhatsApp & CRM pipes',
      group: 'Navigation',
      icon: Plug,
      badge: 'Page',
      action: () => { router.push('/integrations'); onClose(); },
    },
    {
      id: 'nav-gateway',
      title: 'Model Gateway',
      subtitle: 'Budget ledger, telemetry & provider adapters',
      group: 'Navigation',
      icon: Globe,
      badge: 'Master',
      action: () => { router.push('/gateway'); onClose(); },
    },
    {
      id: 'nav-rbac',
      title: 'RBAC & Permissions',
      subtitle: 'Tenant isolation and capability scopes',
      group: 'Navigation',
      icon: Shield,
      badge: 'Master',
      action: () => { router.push('/rbac'); onClose(); },
    },
    {
      id: 'nav-system',
      title: 'System Health & Audit',
      subtitle: 'Append-only audit log & checkpoint integrity',
      group: 'Navigation',
      icon: Settings,
      badge: 'Master',
      action: () => { router.push('/system'); onClose(); },
    },

    // Agent Actions
    {
      id: 'act-mb',
      title: 'Run Media Buyer',
      subtitle: 'Trigger CAC optimization & budget rebalance',
      group: 'Agent Fleet',
      icon: Zap,
      badge: 'Agent',
      action: () => { router.push('/agents'); onClose(); },
    },
    {
      id: 'act-cr',
      title: 'Generate Creative Variants',
      subtitle: 'Draft SEBI-compliant copy for ₹999 checkup',
      group: 'Agent Fleet',
      icon: Sparkles,
      badge: 'Agent',
      action: () => { router.push('/studio'); onClose(); },
    },
    {
      id: 'act-ask',
      title: 'Ask AI Analyst',
      subtitle: 'Grounded search across platform knowledge base',
      group: 'Agent Fleet',
      icon: MessageSquare,
      badge: 'Agent',
      action: () => { router.push('/workspace'); onClose(); },
    },

    // Quick Actions
    {
      id: 'act-new-camp',
      title: 'New Campaign',
      subtitle: 'Configure objective, daily budget and channels',
      group: 'Quick Actions',
      icon: Plus,
      badge: 'Action',
      action: () => {
        onClose();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('helm:open-new-campaign'));
        }
      },
    },
    {
      id: 'act-theme',
      title: 'Toggle Theme',
      subtitle: 'Switch between dark and light appearance',
      group: 'Quick Actions',
      icon: Moon,
      badge: 'Setting',
      action: () => { toggle(); onClose(); },
    },
  ]

  const filtered = query.trim()
    ? items.filter(
        (it) =>
          it.title.toLowerCase().includes(query.toLowerCase()) ||
          it.subtitle.toLowerCase().includes(query.toLowerCase()) ||
          it.group.toLowerCase().includes(query.toLowerCase())
      )
    : items

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) onClose()
        else {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('helm:open-cmd-palette'))
          }
        }
      }

      if (!open) return

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((idx) => (idx + 1) % (filtered.length || 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((idx) => (idx - 1 + (filtered.length || 1)) % (filtered.length || 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filtered, selectedIndex, onClose])

  if (!open) return null

  // Group items by category
  const groups = ['Navigation', 'Agent Fleet', 'Quick Actions'] as const

  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div
        className="cmd-palette-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <div className="cmd-search-box">
          <Search width={18} height={18} color="var(--violet-2)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search across campaigns, agents, pages…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
          />
          <span className="kbd">ESC</span>
        </div>

        <div className="cmd-results">
          {filtered.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>
              No commands or actions matching &ldquo;{query}&rdquo;
            </div>
          ) : (
            groups.map((group) => {
              const groupItems = filtered.filter((i) => i.group === group)
              if (groupItems.length === 0) return null
              return (
                <div key={group}>
                  <div className="cmd-group-label">{group}</div>
                  {groupItems.map((item) => {
                    const globalIdx = filtered.findIndex((x) => x.id === item.id)
                    const isSelected = globalIdx === selectedIndex
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`cmd-item ${isSelected ? 'selected' : ''}`}
                        onClick={item.action}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                      >
                        <div className="cmd-item-icon">
                          <Icon width={15} height={15} />
                        </div>
                        <div className="cmd-item-text">
                          <b>{item.title}</b>
                          <small>{item.subtitle}</small>
                        </div>
                        {item.badge && <span className="cmd-badge">{item.badge}</span>}
                        <ArrowRight width={12} height={12} style={{ opacity: isSelected ? 1 : 0.2 }} />
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        <div className="cmd-footer">
          <span><b>HELM</b> Spotlight</span>
          <div className="cmd-shortcuts">
            <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span><kbd>↵</kbd> Select</span>
            <span><kbd>esc</kbd> Dismiss</span>
          </div>
        </div>
      </div>
    </div>
  )
}

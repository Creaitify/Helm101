import type { Capability } from './rbac'

export interface NavItem {
  label: string
  page: string
  section: 'operate' | 'master'
  icon: string
  cap?: Capability
  badge?: number
  desc?: string
}

export const NAV: NavItem[] = [
  {
    label: 'Analytics',
    page: 'analytics',
    section: 'operate',
    icon: 'LayoutDashboard',
    desc: 'Full-funnel intelligence, live spend pacing, ROAS & CAC dispersion',
  },
  {
    label: 'Campaigns',
    page: 'campaigns',
    section: 'operate',
    icon: 'LineChart',
    desc: 'Active ad sets, channel allocations & daily budget pacing',
  },
  {
    label: 'Creative Studio',
    page: 'studio',
    section: 'operate',
    icon: 'Image',
    desc: 'Generative ad copy with deterministic SEBI compliance checks',
  },
  {
    label: 'Workspace',
    page: 'workspace',
    section: 'operate',
    icon: 'MessageSquare',
    desc: 'Supervised AI analyst with verified line-level source citations',
  },
  {
    label: 'Integrations',
    page: 'integrations',
    section: 'operate',
    icon: 'Plug',
    desc: 'OAuth 2.1 pipes & API connectors (Meta, Google, WhatsApp, GA4)',
  },
  {
    label: 'Approvals',
    page: 'approvals',
    section: 'operate',
    icon: 'CheckCircle',
    badge: 3,
    desc: 'Human-in-the-loop checkpoint gate decisions before execution',
  },
  {
    label: 'Agent Fleet',
    page: 'agents',
    section: 'master',
    icon: 'Bot',
    cap: 'masterConsole',
    desc: 'Autonomous supervisor console for Governor, Media Buyer, Creative & Analyst',
  },
  {
    label: 'Model Gateway',
    page: 'gateway',
    section: 'master',
    icon: 'Globe',
    cap: 'masterConsole',
    desc: 'LLM provider routing, token budget ledger & live telemetry',
  },
  {
    label: 'Training & Evals',
    page: 'training',
    section: 'master',
    icon: 'GraduationCap',
    cap: 'masterConsole',
    desc: 'Grounding benchmarks, prompt datasets & eval test suites',
  },
  {
    label: 'Access & RBAC',
    page: 'rbac',
    section: 'master',
    icon: 'Users',
    cap: 'masterConsole',
    desc: 'Multi-tenant role capability scopes and organization isolation',
  },
  {
    label: 'System Config',
    page: 'system',
    section: 'master',
    icon: 'Settings',
    cap: 'masterConsole',
    desc: 'Append-only audit ledger and SQLite checkpointer database health',
  },
]

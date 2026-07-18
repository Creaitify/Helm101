import type { Capability } from './rbac'
export interface NavItem { label: string; page: string; section: 'operate' | 'master'; icon: string; cap?: Capability; badge?: number }
export const NAV: NavItem[] = [
  { label: 'Analytics', page: 'analytics', section: 'operate', icon: 'LayoutDashboard' },
  { label: 'Campaigns', page: 'campaigns', section: 'operate', icon: 'LineChart' },
  { label: 'Creative Studio', page: 'studio', section: 'operate', icon: 'Image' },
  { label: 'Workspace', page: 'workspace', section: 'operate', icon: 'MessageSquare' },
  { label: 'Integrations', page: 'integrations', section: 'operate', icon: 'Plug' },
  { label: 'Approvals', page: 'approvals', section: 'operate', icon: 'CheckCircle', badge: 3 },
  { label: 'Agent Fleet', page: 'agents', section: 'master', icon: 'Bot', cap: 'masterConsole' },
  { label: 'Model Gateway', page: 'gateway', section: 'master', icon: 'Globe', cap: 'masterConsole' },
  { label: 'Training & Evals', page: 'training', section: 'master', icon: 'GraduationCap', cap: 'masterConsole' },
  { label: 'Access & RBAC', page: 'rbac', section: 'master', icon: 'Users', cap: 'masterConsole' },
  { label: 'System Config', page: 'system', section: 'master', icon: 'Settings', cap: 'masterConsole' },
]

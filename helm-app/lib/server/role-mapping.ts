import 'server-only'
import type { Role } from '../types'
import type { TenantRole } from './tenant-context'

/**
 * The database enum is canonical. These records are exhaustive in both
 * directions, so adding a role to either vocabulary fails to compile until
 * the mapping is updated.
 */
const DB_TO_UI: Record<TenantRole, Role> = {
  owner: 'master',
  agency_admin: 'agency',
  strategist: 'strategist',
  creative: 'creative',
  analyst: 'analyst',
  client_viewer: 'viewer',
}

const UI_TO_DB: Record<Role, TenantRole> = {
  master: 'owner',
  agency: 'agency_admin',
  strategist: 'strategist',
  creative: 'creative',
  analyst: 'analyst',
  viewer: 'client_viewer',
}

export const toUiRole = (dbRole: TenantRole): Role => DB_TO_UI[dbRole]
export const toDbRole = (uiRole: Role): TenantRole => UI_TO_DB[uiRole]

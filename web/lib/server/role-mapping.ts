import 'server-only'
import type { Role } from '../types'

/**
 * The canonical role vocabulary, as helm-api's MembershipRole enum serves it
 * in ContextMeta.role (see docs/roles-and-scopes.md). The API is the only
 * source of these values now; the UI vocabulary in lib/types.ts is
 * presentation-only.
 */
export type CanonicalRole =
  | 'owner'
  | 'agency_admin'
  | 'strategist'
  | 'creative'
  | 'analyst'
  | 'client_viewer'

/**
 * Exhaustive by construction: adding a role to either vocabulary fails to
 * compile until the mapping is updated.
 */
const CANONICAL_TO_UI: Record<CanonicalRole, Role> = {
  owner: 'master',
  agency_admin: 'agency',
  strategist: 'strategist',
  creative: 'creative',
  analyst: 'analyst',
  client_viewer: 'viewer',
}

export const toUiRole = (role: CanonicalRole): Role => CANONICAL_TO_UI[role]

/**
 * ContextMeta.role arrives as a plain string. An unrecognized value is a
 * contract break between the services, not a "default to viewer" case --
 * fail loud so the mismatch is found at the seam, not as a mysteriously
 * gated UI.
 */
export function assertCanonicalRole(role: string): CanonicalRole {
  if (role in CANONICAL_TO_UI) return role as CanonicalRole
  throw new Error(`Unknown canonical role from API: ${role}`)
}

import type { Role } from './types'
export type Capability = 'masterConsole' | 'budgetShift' | 'approveCreative' | 'manageIntegrations' | 'viewAnalytics'

const MATRIX: Record<Capability, Role[]> = {
  masterConsole: ['master'],
  budgetShift: ['master', 'agency', 'strategist'],
  approveCreative: ['master', 'agency', 'strategist', 'creative'],
  manageIntegrations: ['master', 'agency'],
  viewAnalytics: ['master', 'agency', 'strategist', 'creative', 'analyst', 'viewer'],
}
export const can = (role: Role, cap: Capability): boolean => MATRIX[cap].includes(role)

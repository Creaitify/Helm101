import 'server-only'
import type { TenantQueryTransaction } from '../server/tenant-context'
import type { TenantRole } from '../server/tenant-context'
import { toUiRole } from '../server/role-mapping'
import type { IntegrationDetail, SeriesColor, Tenant, User } from '../types'

export async function listUsers(tx: TenantQueryTransaction): Promise<User[]> {
  const rows = await tx.query<{ id: string; display_name: string; email: string; role: TenantRole; status: User['status'] }>(
    'select id, display_name, email, role, status from users order by display_name asc',
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    email: row.email,
    role: toUiRole(row.role),
    status: row.status,
  }))
}

const INTEGRATION_GRAD: [SeriesColor, SeriesColor] = ['violet', 'sky']

export async function listIntegrations(tx: TenantQueryTransaction): Promise<IntegrationDetail[]> {
  const rows = await tx.query<{
    kind: string
    auth_kind: IntegrationDetail['auth']
    status: IntegrationDetail['status']
    scopes: string[]
    last_sync_at: Date | null
  }>('select kind, auth_kind, status, scopes, last_sync_at from integrations order by kind asc')
  return rows.map((row) => ({
    id: row.kind.toLowerCase().replace(/\s+/g, '-'),
    name: row.kind,
    auth: row.auth_kind,
    status: row.status,
    scopes: row.scopes,
    // last_sync_at is a timestamptz; see approvals.ts for why UTC HH:MM is
    // the deliberate, deterministic choice for a server-formatted instant.
    lastSync: row.last_sync_at ? row.last_sync_at.toISOString().slice(11, 16) : '—',
    calls: '—',
    grad: INTEGRATION_GRAD,
  }))
}

export async function getTenantById(tx: TenantQueryTransaction, tenantId: string): Promise<Tenant | null> {
  const [row] = await tx.query<{ slug: string; name: string }>(
    'select slug, name from tenants where id = $1',
    [tenantId],
  )
  return row ? { id: row.slug, name: row.name, region: 'ap-south-1', env: 'prod' } : null
}

export async function listSwitchableTenants(tx: TenantQueryTransaction): Promise<Tenant[]> {
  const rows = await tx.query<{ slug: string; name: string }>(
    'select slug, name from tenants order by name asc',
  )
  return rows.map((row) => ({ id: row.slug, name: row.name, region: 'ap-south-1', env: 'prod' }))
}

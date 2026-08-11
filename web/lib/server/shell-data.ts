import 'server-only'
import { cookies } from 'next/headers'
import type { SwitchableTenant } from '../types'
import type { TenantValue } from '../tenant'
import { tenant as demoTenant } from '../data/mock/fixtures'
import { env, isDemoMode } from './env'
import { listTenantsFromApi } from './tenant-directory'
import { assertCanonicalRole, toUiRole } from './role-mapping'

/** The authenticated caller belongs to no active tenant. Layout routes to /no-access. */
export class NoMembershipError extends Error {
  constructor() {
    super('No active tenant membership')
    this.name = 'NoMembershipError'
  }
}

export interface ShellData {
  value?: TenantValue
  switcher: { tenants?: SwitchableTenant[]; activeId?: string }
}

/**
 * Demo mode renders the same Finnovate shell the fixtures render everywhere
 * else. Passed explicitly (rather than leaning on TenantProvider's client-side
 * FALLBACK) so demo mode is legible in the server tree; the FALLBACK stays as
 * a test safety net.
 */
const DEMO_TENANT_VALUE: TenantValue = { tenant: demoTenant, role: 'master' }

/**
 * Resolves everything the authenticated shell needs, in one place:
 *
 * - Demo mode: the fixture tenant, no API call.
 * - Live mode: the caller's tenant directory from helm-api
 *   (GET /api/v1/tenants), which verifies the JWT, resolves membership, and
 *   returns the active tenant plus ContextMeta (role/scopes -- UI gating
 *   only; FastAPI re-checks every permission on every request).
 *
 * The `helm_active_tenant` cookie is a non-authoritative hint forwarded as
 * X-HELM-Active-Tenant. FastAPI answers an unmatched hint with
 * `no_membership` (deliberately indistinguishable from having none), so an
 * empty result while a hint was sent may just mean the cookie is stale --
 * retry once without it rather than locking a legitimate member out.
 */
export async function loadShellData(): Promise<ShellData> {
  if (isDemoMode()) return { value: DEMO_TENANT_VALUE, switcher: {} }

  const hint = (await cookies()).get('helm_active_tenant')?.value
  let directory = hint ? await listTenantsFromApi({ tenantHint: hint }) : await listTenantsFromApi()
  if (directory.tenants.length === 0 && hint) {
    directory = await listTenantsFromApi()
  }
  const meta = directory.meta
  if (directory.tenants.length === 0 || !meta) throw new NoMembershipError()

  const value: TenantValue = {
    tenant: {
      // Tenant.id is the slug by convention (lib/types.ts); region/env are
      // presentational placeholders -- the API does not model them.
      // TODO(phase-2): serve real region/env once the API does.
      id: meta.tenantSlug,
      name: directory.tenants.find((t) => t.id === meta.tenantId)?.name ?? meta.tenantSlug,
      region: 'cloud',
      env: env.appEnv,
    },
    role: toUiRole(assertCanonicalRole(meta.role)),
  }

  if (directory.tenants.length <= 1) return { value, switcher: {} }
  return {
    value,
    switcher: {
      tenants: directory.tenants.map((t) => ({ tenantId: t.id, slug: t.slug, name: t.name })),
      // activeId is the real UUID, matching each option's value in
      // TenantSwitcher -- NOT the slug.
      activeId: meta.tenantId,
    },
  }
}

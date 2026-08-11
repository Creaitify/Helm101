import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: string) => UUID_RE.test(value)

/**
 * Stores the selected tenant in the `helm_active_tenant` cookie, which the
 * shell forwards to helm-api as the X-HELM-Active-Tenant hint.
 *
 * The cookie is a non-authoritative hint, so no membership check happens
 * here: FastAPI matches it against the caller's OWN memberships on every
 * request and fails closed on a mismatch (an unmatched hint is answered
 * `no_membership`). Semantics are "pick among your own tenants" -- the old
 * Phase A platform-admin impersonation is gone; cross-tenant admin reads are
 * a phase-2 API feature with real authorization.
 *
 * The UUID check is defense in depth: the switcher sends the real tenant
 * UUID, and rejecting anything else caps the cookie's value space so a
 * malformed value never even reaches the header.
 *
 * `secure` is set only in production: in local dev the app is served over
 * plain http://localhost, and a `secure` cookie set there is silently dropped
 * by the browser on the next request, which would make the switcher appear to
 * do nothing.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { tenantId } = (await request.json()) as { tenantId?: string }
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
  if (!isUuid(tenantId)) return NextResponse.json({ error: 'tenantId must be a UUID' }, { status: 400 })

  const response = NextResponse.json({ ok: true })
  response.cookies.set('helm_active_tenant', tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}

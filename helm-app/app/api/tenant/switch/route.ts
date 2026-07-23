import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/auth'
import { resolveMembership } from '@/lib/server/tenant-session'

/**
 * Platform admins only. Stores the selected tenant in a cookie that
 * requireTenantContext reads; a non-admin request is rejected outright.
 *
 * This 403 gate is defense in depth, not the only protection: even if it
 * were removed, resolveMembership ignores an activeTenantId that isn't one
 * of the caller's own memberships unless the caller is a platform admin (see
 * the forged-cookie defense in lib/server/tenant-session.ts). This route
 * additionally refuses to *set* the cookie for a non-admin in the first
 * place, so a non-admin never even gets a stale/no-op switch cookie.
 *
 * secure is set only in production: in local dev the app is served over
 * plain http://localhost, and a `secure` cookie set there is silently
 * dropped by the browser on the next request, which would make the
 * switcher appear to do nothing. Gating on NODE_ENV keeps the cookie
 * secure-only in every deployed environment while keeping local dev usable.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const membership = await resolveMembership(email)
  if (!membership?.isPlatformAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { tenantId } = (await request.json()) as { tenantId?: string }
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const response = NextResponse.json({ ok: true })
  response.cookies.set('helm_active_tenant', tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}

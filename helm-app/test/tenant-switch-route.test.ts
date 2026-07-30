import { describe, it, expect, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const resolveMembership = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/server/tenant-session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/tenant-session')>('@/lib/server/tenant-session')
  return {
    ...actual,
    resolveMembership: (...args: unknown[]) => resolveMembership(...args),
  }
})

import { POST } from '@/app/api/tenant/switch/route'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/tenant/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/tenant/switch', () => {
  beforeEach(() => {
    getServerSession.mockReset()
    resolveMembership.mockReset()
    getServerSession.mockResolvedValue({ user: { email: 'admin@example.com' } })
    resolveMembership.mockResolvedValue({ isPlatformAdmin: true })
  })

  it('accepts a well-formed UUID and sets the cookie', async () => {
    const response = await POST(jsonRequest({ tenantId: VALID_UUID }))
    expect(response.status).toBe(200)
    const cookie = response.cookies.get('helm_active_tenant')
    expect(cookie?.value).toBe(VALID_UUID)
  })

  // Defense in depth (Critical C1): rejects a slug like "finnovate" -- what
  // the old TenantSwitcher used to send -- before it ever reaches the
  // cookie, so a malformed value can never be persisted in the first place.
  it('rejects a non-UUID tenantId (e.g. a slug) with 400', async () => {
    const response = await POST(jsonRequest({ tenantId: 'finnovate' }))
    expect(response.status).toBe(400)
    expect(response.cookies.get('helm_active_tenant')).toBeUndefined()
  })

  it('rejects a missing tenantId with 400', async () => {
    const response = await POST(jsonRequest({}))
    expect(response.status).toBe(400)
  })
})

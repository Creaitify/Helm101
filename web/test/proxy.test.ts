/**
 * Fidelity note — what this test does and does not prove.
 *
 * This test models `config.matcher` with a plain `new RegExp(...)` applied to a bare
 * pathname. That is a coarse proxy for the real thing, not an exact oracle:
 *
 *  - Next.js does NOT run `config.matcher` through `new RegExp` directly. It compiles each
 *    matcher string via `path-to-regexp` (with `sensitive: false`) and wraps the result with
 *    its own prefix/suffix capture groups as part of building the middleware manifest. The
 *    resulting compiled matcher can differ from a naive `new RegExp(pattern)` in edge cases
 *    around anchoring, trailing slashes, and case handling.
 *  - Known divergence: because Next compiles with `sensitive: false`, the real middleware
 *    matcher is CASE-INSENSITIVE — `/LOGIN` is exempt in the real app. This test's plain-
 *    RegExp model has no `i` flag, so `/LOGIN` is treated as protected (a false negative for
 *    the model relative to real behavior). This divergence is intentional/known, not a bug
 *    in this test.
 *
 * What this test DOES prove: that the regex source string in `config.matcher` has correct
 * segment-boundary behavior for the collision cases we care about (e.g. `/login-history` is
 * not accidentally swallowed by a prefix match against `login`). What it does NOT prove: that
 * Next's compiled runtime matcher behaves byte-for-byte identically, including case-folding.
 * We intentionally do not import Next's internal matcher compiler (private API, brittle) to
 * get an exact oracle — this coarse model plus the concrete examples above is the tradeoff.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { NextRequestWithAuth } from 'next-auth/middleware'
import type { NextFetchEvent } from 'next/server'

const { authProxy } = vi.hoisted(() => ({ authProxy: vi.fn() }))
vi.mock('next-auth/middleware', () => ({ default: () => authProxy }))

import proxy, { config } from '@/proxy'

function matches(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname))
}

describe('route protection matcher', () => {
  it('protects application routes, including near-miss collisions with exempt prefixes', () => {
    const protectedPaths = [
      '/analytics',
      '/campaigns',
      '/approvals',
      '/studio',
      '/workspace',
      '/rbac',
      '/',
      // Collision cases: these share a prefix with an exempt path but must NOT be exempt.
      '/loginfoo',
      '/login-history',
      '/no-access-appeal',
      '/api/healthcheck',
      '/api/health-metrics',
      '/api/authenticate',
    ]
    for (const path of protectedPaths) {
      expect(matches(path), `expected ${path} to be PROTECTED`).toBe(true)
    }
  })

  it('leaves auth, health, login, no-access and static assets reachable', () => {
    const exemptPaths = [
      '/login',
      '/no-access',
      '/api/health',
      '/api/auth/signin',
      '/api/auth/callback/google',
      '/api/auth/session',
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
    ]
    for (const path of exemptPaths) {
      expect(matches(path), `expected ${path} to be EXEMPT`).toBe(false)
    }
  })
})

/**
 * The session gate itself. Demo mode must bypass withAuth ENTIRELY: with an
 * empty env there is no AUTH_SECRET, and withAuth answers every request with
 * a NO_SECRET server-error page before it consults any callback — so the only
 * working demo gate is not calling it at all. Live mode must hand the request
 * to withAuth untouched.
 */
describe('proxy demo-mode gate', () => {
  const saved = { HELM_DEMO_MODE: process.env.HELM_DEMO_MODE, HELM_API_BASE_URL: process.env.HELM_API_BASE_URL }
  const request = {} as NextRequestWithAuth
  const event = {} as NextFetchEvent
  const AUTH_RESULT = Symbol('withAuth-handled')

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    authProxy.mockReset()
  })

  function setEnv(values: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  it('waves requests through in demo mode without consulting withAuth', () => {
    setEnv({ HELM_DEMO_MODE: undefined, HELM_API_BASE_URL: undefined })
    const response = proxy(request, event)
    expect(authProxy).not.toHaveBeenCalled()
    // NextResponse.next() marks pass-through with this header.
    expect((response as Response).headers.get('x-middleware-next')).toBe('1')
  })

  it('hands live-mode requests to withAuth untouched', () => {
    setEnv({ HELM_DEMO_MODE: undefined, HELM_API_BASE_URL: 'http://api.test' })
    authProxy.mockReturnValue(AUTH_RESULT)
    expect(proxy(request, event)).toBe(AUTH_RESULT)
    expect(authProxy).toHaveBeenCalledWith(request, event)
  })

  it('an explicit HELM_DEMO_MODE=false restores the login wall even with no API configured', () => {
    // The misconfigured-production case: demo must be refusable outright.
    setEnv({ HELM_DEMO_MODE: 'false', HELM_API_BASE_URL: undefined })
    authProxy.mockReturnValue(AUTH_RESULT)
    expect(proxy(request, event)).toBe(AUTH_RESULT)
  })

  it('an explicit HELM_DEMO_MODE=true opts into demo even with an API configured', () => {
    setEnv({ HELM_DEMO_MODE: 'true', HELM_API_BASE_URL: 'http://api.test' })
    const response = proxy(request, event)
    expect(authProxy).not.toHaveBeenCalled()
    expect((response as Response).headers.get('x-middleware-next')).toBe('1')
  })
})

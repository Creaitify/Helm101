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
import { describe, it, expect } from 'vitest'
import { config } from '@/proxy'

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

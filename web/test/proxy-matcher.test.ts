import { describe, expect, it } from 'vitest'
import { config } from '@/proxy'

/**
 * Anchored with `^...$`: the matcher pattern is a negative-lookahead capturing
 * group with no leading `^`, so an unanchored `new RegExp(config.matcher[0])`
 * lets `.test()` search for a match starting anywhere in the string — e.g. for
 * `/api/auth/signin` it finds a match starting at index 4 (`/auth/signin`,
 * which does not itself start with an exempt prefix) and wrongly reports the
 * exempt auth route as protected. Anchoring reproduces how Next full-matches
 * `config.matcher` patterns against the pathname.
 */
const matcher = new RegExp(`^${config.matcher[0]}$`)

describe('proxy matcher', () => {
  it('protects application routes', () => {
    for (const path of ['/campaigns', '/studio', '/approvals', '/api/tenant/switch']) {
      expect(matcher.test(path)).toBe(true)
    }
  })

  it('exempts auth, health, login and no-access', () => {
    for (const path of ['/api/auth/signin', '/api/auth/callback/auth0', '/api/health', '/login', '/no-access']) {
      expect(matcher.test(path)).toBe(false)
    }
  })

  it('still protects routes that merely start with an exempt name', () => {
    for (const path of ['/login-history', '/api/authenticate']) {
      expect(matcher.test(path)).toBe(true)
    }
  })
})

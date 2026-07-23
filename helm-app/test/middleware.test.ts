import { describe, it, expect } from 'vitest'
import { config } from '@/middleware'

function matches(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname))
}

describe('route protection matcher', () => {
  it('protects application routes', () => {
    for (const path of ['/analytics', '/campaigns', '/approvals', '/studio', '/workspace', '/rbac']) {
      expect(matches(path)).toBe(true)
    }
  })

  it('leaves auth, health, login and no-access reachable', () => {
    for (const path of ['/login', '/no-access', '/api/auth/signin', '/api/auth/callback/google', '/api/health']) {
      expect(matches(path)).toBe(false)
    }
  })
})

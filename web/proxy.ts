import withAuth, { type NextRequestWithAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { NextFetchEvent } from 'next/server'
import { isDemoMode } from '@/lib/demo-mode'

/**
 * Renamed from `middleware.ts`: Next.js 16 deprecates the `middleware` file
 * convention in favour of `proxy`. The import path `next-auth/middleware` is
 * NextAuth's own module name and is unrelated to the Next.js convention, so it
 * stays as it is.
 */
const authProxy = withAuth({ pages: { signIn: '/login' } })

/**
 * Demo mode must bypass withAuth ENTIRELY, not merely relax its `authorized`
 * callback: with an empty env there is no AUTH_SECRET, and withAuth answers
 * every request with a NO_SECRET server-error page before it ever consults
 * callbacks (verified against a running dev server). A checkout with an empty
 * .env.local also registers zero providers in auth.ts, so requiring a session
 * would dead-end every route at a login page that itself says no sign-in
 * method is configured. Demo mode never has a real tenant behind it (the
 * shell serves the fixture tenant and the banner labels it synthetic), so
 * waving requests through exposes nothing.
 *
 * Evaluated per request, not at module load: HELM_DEMO_MODE=false with a
 * configured API restores the login wall with no rebuild of this file.
 */
export default function proxy(request: NextRequestWithAuth, event: NextFetchEvent) {
  if (isDemoMode()) return NextResponse.next()
  return authProxy(request, event)
}

/**
 * Everything is protected except authentication endpoints, the health probe,
 * the login screen, the no-access screen and Next's static assets.
 *
 * The negative-lookahead alternatives below are segment-boundary anchored
 * (`(?:/|$)` for prefixes with subpaths, `$` for exact-only exemptions).
 * A plain, unanchored alternative like `login` would match as a PREFIX with
 * no boundary check, so it would silently swallow any future route that
 * merely starts with the same characters — e.g. `/login-history` would
 * become public (matches `login...`) even though it is a distinct route
 * that should stay protected. Anchoring `login$` means only the exact
 * `/login` path is exempt, while `api/auth(?:/|$)` still exempts every
 * NextAuth subpath (`/api/auth/signin`, `/api/auth/callback/google`, ...)
 * without also exempting an unrelated `/api/authenticate` route.
 */
export const config = {
  matcher: [
    '/((?!api/auth(?:/|$)|api/health$|login$|no-access$|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)',
  ],
}

import withAuth from 'next-auth/middleware'

export default withAuth({ pages: { signIn: '/login' } })

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

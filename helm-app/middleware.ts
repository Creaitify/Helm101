import withAuth from 'next-auth/middleware'

export default withAuth

/**
 * Everything is protected except authentication endpoints, the health probe,
 * the login screen, the no-access screen and Next's static assets.
 */
export const config = {
  matcher: ['/((?!api/auth|api/health|login|no-access|_next/static|_next/image|favicon.ico).*)'],
}

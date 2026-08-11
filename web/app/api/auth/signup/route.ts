import { NextResponse } from 'next/server'
import { SIGNUP_MESSAGES, signupWithAuth0 } from '@/lib/server/auth0-signup'

/**
 * Create an account, then let the client sign in with `signIn('credentials')`.
 *
 * This route deliberately does NOT establish the session itself. next-auth owns
 * session creation, and doing it here would mean minting a session cookie
 * outside the flow that the `jwt` callback and CSRF protection are built around.
 * On success the client calls `signIn('credentials', ...)` with the same values,
 * which runs the normal `authorize` path.
 *
 * The response body carries only a code from a closed set and a message this
 * app wrote. No Auth0 response text ever reaches it, and neither does the
 * submitted password -- the request body is read, destructured, and never
 * echoed.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown }
  } catch {
    return NextResponse.json(
      { code: 'invalid_email', message: SIGNUP_MESSAGES.invalid_email },
      { status: 400 },
    )
  }

  const result = await signupWithAuth0(body.email, body.password)

  // A duplicate address is reported as `created` (see the tradeoff note in
  // lib/server/auth0-signup.ts), so a caller cannot use this endpoint to learn
  // which addresses hold accounts. The status code must match for the same
  // reason -- a distinct status is just as good an oracle as a distinct body.
  const status = result.ok ? 200 : result.code === 'unavailable' ? 502 : 400

  return NextResponse.json(
    { code: result.code, message: SIGNUP_MESSAGES[result.code] },
    { status },
  )
}

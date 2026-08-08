import 'server-only'
import {
  MIN_PASSWORD_LENGTH,
  REALM,
  auth0Config,
  auth0Url,
  isValidEmail,
  isValidPassword,
} from '@/lib/server/auth0-credentials'

/**
 * Account creation against Auth0's `/dbconnections/signup`.
 *
 * The signup result is the classic enumeration surface: an honest "that email is
 * already registered" tells an anonymous caller which addresses hold accounts.
 * See `SIGNUP_RESULTS` below for how that is handled and why.
 */

/**
 * The closed set of outcomes a caller may see. Auth0's own error bodies are
 * mapped into this and never passed through -- they carry connection names,
 * tenant detail, and the enumeration signal.
 */
export type SignupCode =
  | 'created'
  | 'invalid_email'
  | 'weak_password'
  | 'password_too_short'
  | 'unavailable'

export type SignupResult = {
  code: SignupCode
  /**
   * True when the caller should be told the account is ready to sign in to.
   * Note this is true for a duplicate email as well -- see the comment on
   * `user_exists` handling below.
   */
  ok: boolean
}

/**
 * Messages are written here, not derived from Auth0. A password *policy*
 * message is safe and genuinely useful ("too weak" is actionable and reveals
 * nothing about who holds an account); the raw body that carries it is not.
 */
export const SIGNUP_MESSAGES: Record<SignupCode, string> = {
  created: 'Account created. You can sign in now.',
  invalid_email: 'Enter a valid email address.',
  weak_password: 'Choose a stronger password.',
  password_too_short: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  unavailable: 'Could not create the account right now. Please try again later.',
}

/**
 * Map an Auth0 signup error to one of our codes.
 *
 * ENUMERATION TRADEOFF -- the deliberate decision in this file.
 *
 * Auth0 answers a duplicate address with `user_exists` / `invalid_signup`.
 * Reporting that faithfully would let anyone submit a list of addresses and
 * learn which are registered. So `user_exists` is mapped to `created`: the
 * caller is told the same thing a genuine new account is told, and cannot
 * distinguish the two.
 *
 * The cost is real and worth stating: a person who genuinely forgot they had an
 * account is told "account created", then finds their chosen password does not
 * work, because it was never applied to the existing account. That is a worse
 * experience than "you already have an account".
 *
 * It is accepted here because the alternative leaks account existence to an
 * unauthenticated caller at zero cost to the attacker, and because the recovery
 * path is intact: the sign-in form's failure message points at password reset,
 * which resolves the confused-legitimate-user case without an oracle. The
 * conventional full fix is to send a verification email that differs in content
 * (welcome vs. "you already have an account") while the HTTP response stays
 * identical -- that keeps the response uniform and moves the disambiguation into
 * a channel only the address owner can read. That requires mail sending, which
 * this app does not yet have; when it does, this is where it hooks in.
 *
 * `invalid_signup` is Auth0's deliberately-vague duplicate variant and is mapped
 * identically, for the same reason.
 */
export function mapSignupError(status: number, code: unknown, name: unknown): SignupCode {
  const raw = typeof code === 'string' ? code : typeof name === 'string' ? name : ''

  if (raw === 'user_exists' || raw === 'invalid_signup') return 'created'
  if (raw === 'PasswordStrengthError' || raw === 'password_strength_error') return 'weak_password'
  if (raw === 'PasswordHistoryError' || raw === 'PasswordDictionaryError') return 'weak_password'
  if (raw === 'PasswordNoUserInfoError') return 'weak_password'
  if (raw === 'invalid_password') return 'weak_password'
  if (status === 400 && raw === 'invalid_request') return 'invalid_email'

  return 'unavailable'
}

/**
 * Create an account. Validates locally before any network call, so a malformed
 * email or a short password costs no round trip and reaches no third party.
 */
export async function signupWithAuth0(
  email: unknown,
  password: unknown,
): Promise<SignupResult> {
  if (!isValidEmail(email)) return { code: 'invalid_email', ok: false }
  // Checked before `isValidPassword` would fold it in, so the caller gets the
  // actionable length message rather than a generic one.
  if (typeof password !== 'string' || !isValidPassword(password)) {
    return { code: 'password_too_short', ok: false }
  }

  const config = auth0Config()
  if (!config) return { code: 'unavailable', ok: false }

  let response: Response
  try {
    response = await fetch(auth0Url(config.issuer, '/dbconnections/signup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        email: email.trim(),
        password,
        connection: REALM,
      }),
    })
  } catch {
    return { code: 'unavailable', ok: false }
  }

  if (response.ok) return { code: 'created', ok: true }

  // The body is parsed ONLY to read the error code, and only the code -- never
  // `description`, `message`, or `policy`, which restate the submitted email and
  // the tenant's password policy verbatim. Nothing from here is echoed back.
  let code: unknown
  let name: unknown
  try {
    const body = (await response.json()) as { code?: unknown; name?: unknown; error?: unknown }
    code = body.code ?? body.error
    name = body.name
  } catch {
    // Ignored: a body we cannot parse tells us nothing, and its text must not
    // travel any further than this line.
  }

  const mapped = mapSignupError(response.status, code, name)
  return { code: mapped, ok: mapped === 'created' }
}

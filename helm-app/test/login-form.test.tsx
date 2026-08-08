/**
 * The embedded email/password form.
 *
 * The two properties that matter most here are the ones a user cannot see
 * failing: one error message for both credential failure modes (anything else
 * is an enumeration oracle), and the password never appearing in rendered
 * output, an error, or anything handed to a logger.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginButtons } from '@/app/login/LoginButtons'

const signIn = vi.fn()
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signIn(...args) }))

const PASSWORD = 'correct-horse-battery-staple-9271'
const EMAIL = 'user@example.com'

let assigned: string | null = null

beforeEach(() => {
  signIn.mockReset()
  assigned = null
  // jsdom refuses a real navigation; capture it instead so the success path
  // can be asserted rather than throwing.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: (url: string) => (assigned = url), href: '' },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function fillAndSubmit(button = /sign in/i) {
  await userEvent.type(screen.getByLabelText(/email/i), EMAIL)
  await userEvent.type(screen.getByLabelText(/password/i), PASSWORD)
  await userEvent.click(screen.getByRole('button', { name: button }))
}

describe('the embedded form renders and is accessible', () => {
  it('shows labelled email and password fields of the right types', () => {
    render(<LoginButtons providerIds={['credentials']} />)

    // getByLabelText only succeeds through a real label association.
    const email = screen.getByLabelText(/email/i)
    const password = screen.getByLabelText(/password/i)

    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('submits on Enter from within the form', async () => {
    signIn.mockResolvedValue({ ok: true, error: null, url: '/analytics' })
    render(<LoginButtons providerIds={['credentials']} />)

    await userEvent.type(screen.getByLabelText(/email/i), EMAIL)
    await userEvent.type(screen.getByLabelText(/password/i), `${PASSWORD}{Enter}`)

    // A div-with-onClick would not do this; a real <form> does.
    await waitFor(() => expect(signIn).toHaveBeenCalled())
  })

  it('has an alert region for errors', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/incorrect/i)
  })
})

describe('sign in', () => {
  it('calls signIn with the credentials provider and redirect disabled', async () => {
    signIn.mockResolvedValue({ ok: true, error: null, url: '/analytics' })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()

    // `redirect: false` is load-bearing: with the default, next-auth navigates
    // to its own error page and the single-message property below is bypassed
    // entirely by a URL that names the failure.
    expect(signIn).toHaveBeenCalledWith('credentials', {
      email: EMAIL,
      password: PASSWORD,
      redirect: false,
    })
  })

  it('navigates on success', async () => {
    signIn.mockResolvedValue({ ok: true, error: null, url: '/analytics' })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()

    await waitFor(() => expect(assigned).toBe('/analytics'))
  })

  it('does not navigate when authorize refused the credentials', async () => {
    // `authorize` returning null surfaces here as `error: 'CredentialsSignin'`.
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin', url: null })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()

    await screen.findByRole('alert')
    // The user must not end up signed in or moved along.
    expect(assigned).toBeNull()
  })
})

describe('failure messages cannot distinguish the two causes', () => {
  /**
   * The enumeration assertion at the UI layer. next-auth returns the same
   * `CredentialsSignin` for both, but a UI that inspected anything else -- a
   * status, a url, a differing shape -- could still leak the difference. This
   * renders both and compares the actual text.
   */
  it('shows the identical message for a wrong password and an unknown account', async () => {
    signIn.mockResolvedValue({
      ok: false,
      error: 'CredentialsSignin',
      status: 401,
      url: null,
    })
    const wrongPassword = render(<LoginButtons providerIds={['credentials']} />)
    await fillAndSubmit()
    const wrongText = (await screen.findByRole('alert')).textContent
    wrongPassword.unmount()

    signIn.mockResolvedValue({
      ok: false,
      error: 'CredentialsSignin',
      status: 401,
      url: null,
    })
    render(<LoginButtons providerIds={['credentials']} />)
    await fillAndSubmit()
    const unknownText = (await screen.findByRole('alert')).textContent

    expect(unknownText).toBe(wrongText)
    // Non-vacuous: the message is real text, not two empty strings compared
    // equal to each other.
    expect(wrongText).toMatch(/incorrect/i)
    expect(wrongText!.length).toBeGreaterThan(10)
  })

  it('never names the account, the email, or which field was wrong', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin', url: null })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()
    const message = (await screen.findByRole('alert')).textContent!.toLowerCase()

    for (const forbidden of [
      'not found',
      'no such',
      'does not exist',
      "doesn't exist",
      'unknown user',
      'no account',
      'wrong password',
      'incorrect password',
      EMAIL.toLowerCase(),
    ]) {
      expect(message, `message revealed "${forbidden}"`).not.toContain(forbidden)
    }
  })
})

describe('the password never escapes', () => {
  it('appears in no rendered text, and in no error message', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin', url: null })
    const { container } = render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()
    await screen.findByRole('alert')

    // Visible text first: the password must never be rendered as content, which
    // is where an error message that echoed it would land.
    expect(container.textContent).not.toContain(PASSWORD)
    expect(screen.getByRole('alert').textContent).not.toContain(PASSWORD)

    // Then the markup -- but excluding the password input's own `value`, which
    // legitimately holds it: it is a controlled input and that IS the field the
    // user is typing into. React reflects `value` into the serialized DOM in
    // jsdom, so a naive `innerHTML` check fails on the correct implementation.
    // Everything OTHER than that one attribute must be clean, which is the
    // property actually worth asserting: no second copy anywhere.
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement
    expect(passwordInput.value).toBe(PASSWORD)

    const markupWithoutTheField = container.innerHTML.replace(
      `value="${PASSWORD}"`,
      'value="[the password field]"',
    )
    // Guard against the replace being a silent no-op (which would make the
    // assertion below vacuous): exactly one occurrence is expected, so a second
    // copy elsewhere survives the replace and fails.
    expect(container.innerHTML.split(`value="${PASSWORD}"`).length - 1).toBe(1)
    expect(markupWithoutTheField).not.toContain(PASSWORD)
  })

  it('is not written to the console by the failure path', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin', url: null })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()
    await screen.findByRole('alert')

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(PASSWORD)
      }
    }
  })

  it('is not written to the console when signIn throws carrying it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    // A rejection whose message embeds the password -- the realistic shape of an
    // accidental leak, since fetch errors can include request detail.
    signIn.mockRejectedValue(new Error(`network failed for ${PASSWORD}`))
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()
    const alert = await screen.findByRole('alert')

    expect(alert.textContent).not.toContain(PASSWORD)
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(PASSWORD)
      }
    }
  })

  it('clears the password from state after a successful sign in', async () => {
    signIn.mockResolvedValue({ ok: true, error: null, url: '/analytics' })
    render(<LoginButtons providerIds={['credentials']} />)

    await fillAndSubmit()

    await waitFor(() => expect(assigned).toBe('/analytics'))
    expect(screen.getByLabelText(/password/i)).toHaveValue('')
  })
})

describe('signup mode', () => {
  it('switches to create-account mode and back', async () => {
    render(<LoginButtons providerIds={['credentials']} />)

    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    // Password managers must not offer the existing credential for a new one.
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'new-password')

    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  it('posts to the signup route, then signs in with the same credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'created', message: 'Account created. You can sign in now.' }),
    } as Response)
    signIn.mockResolvedValue({ ok: true, error: null, url: '/analytics' })

    render(<LoginButtons providerIds={['credentials']} />)
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    await fillAndSubmit(/create account/i)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/signup')
    expect(JSON.parse(init.body as string)).toEqual({ email: EMAIL, password: PASSWORD })

    // The account is created AND the user ends up signed in, not left at a
    // form with no feedback.
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('credentials', {
      email: EMAIL,
      password: PASSWORD,
      redirect: false,
    }))
  })

  it('shows the server message and does not sign in when signup fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'weak_password', message: 'Choose a stronger password.' }),
    } as Response)

    render(<LoginButtons providerIds={['credentials']} />)
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    await fillAndSubmit(/create account/i)

    expect(await screen.findByRole('alert')).toHaveTextContent(/stronger password/i)
    expect(signIn).not.toHaveBeenCalled()
  })
})

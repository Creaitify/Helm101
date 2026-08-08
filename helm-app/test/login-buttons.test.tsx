/**
 * The login page had no test, and that is exactly how it shipped with no way
 * to log in: `auth.ts` registered the Auth0 provider, the tests asserted the
 * registration, and `LoginButtons` had no `auth0` branch -- so the page
 * rendered a heading, a tagline, and nothing else. Not even the empty-state
 * message, because the provider array was not empty.
 *
 * So these tests are written against the property that actually matters: a
 * registered provider must produce something a user can click, or an explicit
 * message. Never a blank card.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginButtons } from '@/app/login/LoginButtons'

const signIn = vi.fn()
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signIn(...args) }))

beforeEach(() => signIn.mockClear())

describe('LoginButtons', () => {
  it('renders an Auth0 control when Auth0 is the only provider', () => {
    render(<LoginButtons providerIds={['auth0']} />)

    // The regression: this environment (Auth0 only) rendered nothing at all.
    expect(screen.getByRole('button', { name: /auth0/i })).toBeInTheDocument()
    expect(screen.queryByText(/no sign-in method/i)).not.toBeInTheDocument()
  })

  it('signs in with the auth0 provider id, not some other provider', async () => {
    render(<LoginButtons providerIds={['auth0']} />)

    await userEvent.click(screen.getByRole('button', { name: /auth0/i }))

    // Asserting the provider id specifically: signIn() with the wrong id
    // redirects to a provider whose token FastAPI will reject for wrong
    // audience, which reads as broken auth rather than a wrong button.
    expect(signIn).toHaveBeenCalledWith('auth0', { callbackUrl: '/analytics' })
  })

  it('renders every configured provider, not just the first', () => {
    render(<LoginButtons providerIds={['auth0', 'google', 'azure-ad']} />)

    expect(screen.getByRole('button', { name: /auth0/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeInTheDocument()
  })

  it('still works for a Phase A environment with no Auth0', async () => {
    render(<LoginButtons providerIds={['google']} />)

    await userEvent.click(screen.getByRole('button', { name: /google/i }))

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/analytics' })
    expect(screen.queryByRole('button', { name: /auth0/i })).not.toBeInTheDocument()
  })

  it('shows the empty state when nothing is configured', () => {
    render(<LoginButtons providerIds={[]} />)

    expect(screen.getByText(/no sign-in method/i)).toBeInTheDocument()
  })

  it('shows the empty state rather than a blank card for an unrenderable provider', () => {
    // The precise shape of the bug: a provider is configured, so the array is
    // not empty and the old empty-state check did not fire -- but no branch
    // renders it, so the user got a card with no controls and no explanation.
    render(<LoginButtons providerIds={['okta', 'saml']} />)

    expect(screen.getByText(/no sign-in method/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders the embedded form when the credentials provider is registered', () => {
    render(<LoginButtons providerIds={['credentials']} />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.queryByText(/no sign-in method/i)).not.toBeInTheDocument()
  })

  it('offers Google alongside the embedded form', () => {
    render(<LoginButtons providerIds={['credentials', 'auth0', 'google']} />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
  })

  it('signs in with Google by its own provider id from the combined layout', async () => {
    render(<LoginButtons providerIds={['credentials', 'google']} />)

    await userEvent.click(screen.getByRole('button', { name: /google/i }))

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/analytics' })
  })

  it('still renders an Auth0 redirect button when credentials are not registered', () => {
    // The Auth0-only environment that caused the original outage. The embedded
    // form is unavailable there, so the redirect button must still appear.
    render(<LoginButtons providerIds={['auth0']} />)

    expect(screen.getByRole('button', { name: /auth0/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('never renders a card with neither a control nor a message', () => {
    // The invariant behind all of the above, stated once over every input
    // shape that has occurred in practice -- now including every combination
    // the credentials provider introduces.
    for (const providerIds of [
      [],
      ['auth0'],
      ['google'],
      ['azure-ad'],
      ['okta'],
      ['auth0', 'google'],
      ['credentials'],
      ['credentials', 'auth0'],
      ['credentials', 'google'],
      ['credentials', 'azure-ad'],
      ['credentials', 'auth0', 'google', 'azure-ad'],
      ['credentials', 'okta'],
      ['okta', 'saml'],
    ]) {
      const { unmount } = render(<LoginButtons providerIds={providerIds} />)

      const hasControl = screen.queryAllByRole('button').length > 0
      const hasMessage = screen.queryByText(/no sign-in method/i) !== null
      // A form with no submit control is as unusable as a blank card, so an
      // input alone does not satisfy the invariant -- a button must exist.

      expect(hasControl || hasMessage, `rendered nothing for [${providerIds.join(', ')}]`).toBe(true)
      unmount()
    }
  })

  it('gives every credentials combination a working submit control, not just any button', () => {
    // Stronger than the invariant above: when the embedded form renders, it
    // must be submittable. A form whose only buttons were the mode toggle and
    // an OAuth redirect would satisfy "has a control" while being unusable.
    for (const providerIds of [
      ['credentials'],
      ['credentials', 'auth0'],
      ['credentials', 'google'],
      ['credentials', 'auth0', 'google', 'azure-ad'],
    ]) {
      const { unmount } = render(<LoginButtons providerIds={providerIds} />)

      expect(
        screen.getByRole('button', { name: /^sign in$/i }),
        `no submit control for [${providerIds.join(', ')}]`,
      ).toBeInTheDocument()
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
      unmount()
    }
  })
})

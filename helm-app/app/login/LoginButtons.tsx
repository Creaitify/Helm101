'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'

const RENDERABLE_PROVIDERS = ['credentials', 'auth0', 'google', 'azure-ad'] as const

const CALLBACK_URL = '/analytics'

/**
 * ONE message for both "no such account" and "wrong password".
 *
 * These are the same failure as far as this UI is concerned, and they must stay
 * that way: any difference between them lets an anonymous visitor test an
 * address for existence. `authorize` already returns a single `null` for every
 * cause, so there is nothing here to distinguish even if someone tried.
 */
const SIGNIN_FAILED = 'Email or password is incorrect.'

export function LoginButtons({ providerIds }: { providerIds: string[] }) {
  // A provider that is registered but has no branch below renders NOTHING --
  // no button, and not the empty-state message either, because the array is
  // not empty. That is exactly how an Auth0-only environment shipped a login
  // page with no way to log in. Treat "configured but unrenderable" as the
  // empty case rather than showing a blank card.
  const usable = providerIds.filter((id) =>
    (RENDERABLE_PROVIDERS as readonly string[]).includes(id),
  )

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (usable.length === 0) {
    return <p>No sign-in method is configured for this environment yet.</p>
  }

  const hasCredentials = usable.includes('credentials')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        // Only our own code is read; the server never sends Auth0 text.
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        if (!response.ok) {
          setError(body.message ?? 'Could not create the account.')
          return
        }
        // Fall through to sign in with the credentials just created.
      }

      const result = await signIn('credentials', { email, password, redirect: false })

      if (!result || result.error) {
        // `result.error` is next-auth's `CredentialsSignin` constant, never
        // anything derived from Auth0. It is discarded rather than rendered.
        setError(SIGNIN_FAILED)
        return
      }
      // The password is dropped from component state the moment it is no longer
      // needed, so it does not sit in memory behind a rendered page.
      setPassword('')
      window.location.assign(result.url ?? CALLBACK_URL)
    } catch {
      setError(SIGNIN_FAILED)
    } finally {
      setBusy(false)
    }
  }

  // One source of truth for the redirect providers, used whether or not the
  // embedded form is present. Auth0's own button is redundant when credentials
  // are available (both authenticate against the same Auth0 tenant), so it is
  // shown only as the fallback for an environment without the embedded form --
  // where it must still render, or that environment has no way to log in.
  const redirectProviders: { id: string; label: string }[] = [
    ...(usable.includes('auth0') && !hasCredentials
      ? [{ id: 'auth0', label: 'Continue with Auth0' }]
      : []),
    ...(usable.includes('google') ? [{ id: 'google', label: 'Continue with Google' }] : []),
    ...(usable.includes('azure-ad') ? [{ id: 'azure-ad', label: 'Continue with Microsoft' }] : []),
  ]

  const oauthButtons = redirectProviders.map((provider, index) => (
    <Button
      key={provider.id}
      // The first control on the card is the primary one. With the embedded
      // form present that is the form's submit button, so these stay secondary.
      variant={!hasCredentials && index === 0 ? 'primary' : undefined}
      onClick={() => signIn(provider.id, { callbackUrl: CALLBACK_URL })}
    >
      {provider.label}
    </Button>
  ))

  // No credentials provider: redirect buttons alone. This branch is what keeps
  // an OAuth-only environment from rendering a blank card.
  if (!hasCredentials) return <>{oauthButtons}</>

  const hasOauth = redirectProviders.length > 0

  return (
    <>
      <form className="login-form" onSubmit={submit}>
        <label className="login-field" htmlFor="login-email">
          Email
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="login-field" htmlFor="login-password">
          Password
          <input
            id="login-password"
            name="password"
            type="password"
            // `new-password` in signup mode stops password managers offering the
            // existing credential for an account being created.
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {/* Always in the tree so assistive tech announces into a region that
            already exists, rather than one appearing mid-interaction. */}
        <p className="login-error" role="alert">
          {error ?? notice ?? ''}
        </p>

        <Button variant="primary" type="submit" disabled={busy}>
          {mode === 'signup' ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      {hasOauth && (
        <>
          <p className="login-divider">or</p>
          {oauthButtons}
        </>
      )}

      <p className="login-switch">
        {mode === 'signin' ? (
          <>
            New here?{' '}
            <button
              type="button"
              className="login-link"
              onClick={() => {
                setMode('signup')
                setError(null)
                setNotice(null)
              }}
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button
              type="button"
              className="login-link"
              onClick={() => {
                setMode('signin')
                setError(null)
                setNotice(null)
              }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </>
  )
}

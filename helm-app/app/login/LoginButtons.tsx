'use client'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'

const RENDERABLE_PROVIDERS = ['auth0', 'google', 'azure-ad'] as const

export function LoginButtons({ providerIds }: { providerIds: string[] }) {
  // A provider that is registered but has no branch below renders NOTHING --
  // no button, and not the empty-state message either, because the array is
  // not empty. That is exactly how an Auth0-only environment shipped a login
  // page with no way to log in. Treat "configured but unrenderable" as the
  // empty case rather than showing a blank card.
  const usable = providerIds.filter((id) =>
    (RENDERABLE_PROVIDERS as readonly string[]).includes(id),
  )

  if (usable.length === 0) {
    return <p>No sign-in method is configured for this environment yet.</p>
  }

  // Auth0 is listed first and styled primary: it is the issuer FastAPI verifies
  // against, so it is the only provider whose session can reach the HELM API.
  // Google and Microsoft remain for the Phase A pages that still read Neon
  // directly, and are deliberately secondary.
  return (
    <>
      {usable.includes('auth0') && (
        <Button variant="primary" onClick={() => signIn('auth0', { callbackUrl: '/analytics' })}>
          Continue with Auth0
        </Button>
      )}
      {usable.includes('google') && (
        <Button
          variant={usable.includes('auth0') ? undefined : 'primary'}
          onClick={() => signIn('google', { callbackUrl: '/analytics' })}
        >
          Continue with Google
        </Button>
      )}
      {usable.includes('azure-ad') && (
        <Button onClick={() => signIn('azure-ad', { callbackUrl: '/analytics' })}>
          Continue with Microsoft
        </Button>
      )}
    </>
  )
}

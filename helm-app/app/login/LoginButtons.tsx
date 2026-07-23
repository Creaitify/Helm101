'use client'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'

export function LoginButtons({ providerIds }: { providerIds: string[] }) {
  if (providerIds.length === 0) {
    return <p>No sign-in method is configured for this environment yet.</p>
  }

  return (
    <>
      {providerIds.includes('google') && (
        <Button variant="primary" onClick={() => signIn('google', { callbackUrl: '/analytics' })}>
          Continue with Google
        </Button>
      )}
      {providerIds.includes('azure-ad') && (
        <Button onClick={() => signIn('azure-ad', { callbackUrl: '/analytics' })}>
          Continue with Microsoft
        </Button>
      )}
    </>
  )
}

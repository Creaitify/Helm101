import type { NextAuthOptions } from 'next-auth'
import Google from 'next-auth/providers/google'
import AzureAD from 'next-auth/providers/azure-ad'
import { env } from '@/lib/server/env'

const providers: NextAuthOptions['providers'] = []

if (env.googleClientId && env.googleClientSecret) {
  providers.push(Google({ clientId: env.googleClientId, clientSecret: env.googleClientSecret }))
}

if (env.microsoftClientId && env.microsoftClientSecret) {
  providers.push(AzureAD({
    clientId: env.microsoftClientId,
    clientSecret: env.microsoftClientSecret,
    tenantId: env.microsoftIssuer,
  }))
}

export const authOptions: NextAuthOptions = {
  secret: env.authSecret,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers,
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },
}

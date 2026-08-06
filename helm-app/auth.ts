import type { NextAuthOptions } from 'next-auth'
import Google from 'next-auth/providers/google'
import AzureAD from 'next-auth/providers/azure-ad'
import Auth0 from 'next-auth/providers/auth0'
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

// `auth0Audience` is part of the guard, not just the params. Registering without
// it would send `audience: undefined`, and Auth0 answers that with an opaque
// access token carrying no `aud` claim -- unverifiable against the JWKS, so every
// FastAPI call 401s. That failure surfaces at first login and looks like broken
// auth rather than missing config, so refuse to register instead.
if (env.auth0Issuer && env.auth0ClientId && env.auth0ClientSecret && env.auth0Audience) {
  providers.push(
    Auth0({
      clientId: env.auth0ClientId,
      clientSecret: env.auth0ClientSecret,
      issuer: env.auth0Issuer,
      authorization: {
        params: {
          // Without an audience Auth0 issues an opaque token that carries no
          // `aud` claim and cannot be verified against the API's JWKS.
          audience: env.auth0Audience,
          scope: 'openid profile email',
        },
      },
    }),
  )
}

export const authOptions: NextAuthOptions = {
  secret: env.authSecret,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers,
  callbacks: {
    jwt({ token, account }) {
      // `account` is present only on the sign-in call. Every later call must
      // preserve what was stored then, or the access token vanishes after the
      // first request and every FastAPI call 401s.
      //
      // `account.access_token` — never `account.id_token`. The ID token
      // verifies against the same JWKS but carries the wrong `aud`, so FastAPI
      // rejects it in a way that looks like broken auth.
      if (account) {
        token.accessToken = account.access_token
        token.accessTokenExpires = account.expires_at
        token.identitySubject = account.providerAccountId
      }
      return token
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      if (session.user) session.user.identitySubject = token.identitySubject
      session.accessToken = token.accessToken
      return session
    },
  },
}

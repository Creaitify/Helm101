# HELM Sub-project 2 — Auth0 and the First BFF Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real person signs in through Auth0 and helm-app renders their tenant list from FastAPI — not from a direct Neon query.

**Architecture:** Auth0 issues an access token audienced at `helm-api`. Auth.js carries that token in the session. A single HTTP client module in helm-app attaches it as a bearer token to FastAPI calls and translates RFC 9457 problem responses into typed errors. FastAPI verifies it with the provider-agnostic verifier sub-project 1 built, learning nothing about Auth0 beyond four environment values. A CLI command provisions real users deliberately, because Stage 1 refuses to auto-create them.

**Tech Stack:** Auth0 (hosted OIDC), NextAuth v4.24.15, Next.js 16.2.10, React 19.2.4, TypeScript 5, vitest 4, FastAPI, SQLAlchemy 2 async, Alembic, Python 3.13.

**Spec:** `docs/superpowers/specs/2026-08-05-helm-vertical-slice-design.md`

**Depends on:** `docs/superpowers/plans/2026-07-30-helm-stage-1-identity-spine.md` must be complete. This plan consumes `GET /api/v1/tenants`, `app/auth/jwt_verifier.py`, `app/api/deps.py`, and `Settings.require_oidc()` from it.

## Global Constraints

- Two projects. FastAPI work is in `F:\Codes\HELM\helm-api`; Next.js work is in `F:\Codes\HELM\helm-app`. Every command states which.
- **FastAPI gates before every commit touching `helm-api`:** `./.venv/Scripts/python.exe -m pytest -q`, `./.venv/Scripts/python.exe -m ruff check .`, `./.venv/Scripts/python.exe -m mypy app`.
- **helm-app gates before every commit touching `helm-app`:** `npm test`, `npm run lint`, `npx tsc --noEmit`.
- `from __future__ import annotations` is the first import line of every new Python module.
- Every Python module, class, and public function gets a one-line docstring.
- **Never log, echo, or place in an error message:** an access token, an ID token, a client secret, a connection string, or a raw Auth0 error body.
- **Identity is keyed on `(identity_issuer, identity_subject)`. Email is never an identity key.** Phase A's `resolveMembership(email)` violates this; Task 8 documents why it is left alone rather than "fixed" in passing.
- **No error distinguishes "tenant does not exist" from "caller has no membership".** Both surface identically.
- FastAPI gains no Auth0 SDK and no Auth0-shaped code. Auth0 enters only as `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_AUDIENCE`, `OIDC_ALLOWED_ALGORITHMS`.
- This project is **Next.js 16.2.10**, which differs from most training data. `helm-app/AGENTS.md` requires reading the relevant guide under `node_modules/next/dist/docs/` before writing code. Two live consequences, both already verified and handled by this plan: the `middleware` file convention is deprecated in favour of `proxy` (Task 7), and the `proxy` runtime is Node.js only and not configurable.
- Auth0 calls its accounts "tenants". Throughout this plan *tenant* unqualified always means a **HELM** tenant.

---

## File Structure

**Created — `helm-api`:**
- `app/cli/__init__.py` — package marker
- `app/cli/provision.py` — audited user + membership provisioning command
- `tests/test_provision_command.py` — provisioning behaviour on testcontainers

**Created — `helm-app`:**
- `lib/server/helm-api-client.ts` — the only module that knows FastAPI's URL
- `lib/server/helm-api-errors.ts` — problem-details → typed error translation
- `proxy.ts` — replaces `middleware.ts` (Next 16 convention)
- `test/helm-api-client.test.ts`
- `test/helm-api-errors.test.ts`
- `test/auth-token-propagation.test.ts`

**Modified — `helm-app`:**
- `lib/server/env.ts` — Auth0 and FastAPI base-URL settings
- `auth.ts` — Auth0 provider; access token carried into the session
- `types/next-auth.d.ts` — session/JWT type augmentation
- `lib/tenant.tsx` or its server caller — tenant list sourced from FastAPI

**Deleted — `helm-app`:**
- `middleware.ts` — renamed to `proxy.ts` in Task 7

**Modified — `helm-api`:**
- `.env.example` — Auth0 values

---

## Task 1: Auth0 configuration and environment contract

This task provisions nothing in code — it establishes the values every later task consumes, and proves helm-app fails loudly rather than silently when they are absent.

**Files:**
- Modify: `helm-app/lib/server/env.ts:8-20`
- Test: `helm-app/test/env-auth0.test.ts` (create)

**Interfaces:**
- Consumes: the existing `env` object and `requireServerEnv` from `lib/server/env.ts`
- Produces: `env.auth0Issuer`, `env.auth0ClientId`, `env.auth0ClientSecret`, `env.auth0Audience`, `env.helmApiBaseUrl` — all `string | undefined`

- [ ] **Step 1: Create the Auth0 API and application (manual, one time)**

In the Auth0 dashboard:

1. **Applications → APIs → Create API.** Name `HELM API`. Identifier `helm-api` — this exact string becomes both `AUTH0_AUDIENCE` and FastAPI's `OIDC_AUDIENCE`. Signing algorithm **RS256**. Stage 1's config validator rejects symmetric algorithms, so HS256 here would fail at FastAPI startup.
2. **Applications → Create Application.** Name `HELM Web`. Type **Regular Web Application**.
3. In that application's settings, set **Allowed Callback URLs** to `http://localhost:3000/api/auth/callback/auth0` and **Allowed Logout URLs** to `http://localhost:3000`.
4. Record the domain, client id, and client secret.

The identifier `helm-api` must be identical in Auth0, `AUTH0_AUDIENCE`, and `OIDC_AUDIENCE`. A mismatch produces a token that verifies cryptographically and is then rejected for wrong audience — a confusing failure worth avoiding by construction.

- [ ] **Step 2: Write the failing test**

Create `helm-app/test/env-auth0.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'

async function loadEnv(values: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return await import('@/lib/server/env')
}

afterEach(() => {
  vi.resetModules()
})

describe('Auth0 environment contract', () => {
  it('exposes every Auth0 value the provider needs', async () => {
    const { env } = await loadEnv({
      AUTH0_ISSUER: 'https://helm.eu.auth0.com',
      AUTH0_CLIENT_ID: 'client-id',
      AUTH0_CLIENT_SECRET: 'client-secret',
      AUTH0_AUDIENCE: 'helm-api',
      HELM_API_BASE_URL: 'http://localhost:8000',
    })
    expect(env.auth0Issuer).toBe('https://helm.eu.auth0.com')
    expect(env.auth0ClientId).toBe('client-id')
    expect(env.auth0ClientSecret).toBe('client-secret')
    expect(env.auth0Audience).toBe('helm-api')
    expect(env.helmApiBaseUrl).toBe('http://localhost:8000')
  })

  it('reports absent values as undefined rather than empty strings', async () => {
    const { env } = await loadEnv({
      AUTH0_ISSUER: '   ',
      AUTH0_CLIENT_ID: undefined,
      AUTH0_CLIENT_SECRET: undefined,
      AUTH0_AUDIENCE: undefined,
      HELM_API_BASE_URL: undefined,
    })
    expect(env.auth0Issuer).toBeUndefined()
    expect(env.auth0ClientId).toBeUndefined()
  })

  it('requireServerEnv throws a named error for a missing FastAPI base URL', async () => {
    const { requireServerEnv } = await loadEnv({ HELM_API_BASE_URL: undefined })
    expect(() => requireServerEnv('helmApiBaseUrl')).toThrow(/helmApiBaseUrl/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run from `helm-app`: `npm test -- env-auth0`
Expected: FAIL — `env.auth0Issuer` is `undefined` because the keys do not exist yet.

- [ ] **Step 4: Add the settings**

In `helm-app/lib/server/env.ts`, add these entries inside the `env` object, after `microsoftIssuer`:

```ts
  auth0Issuer: optional('AUTH0_ISSUER'),
  auth0ClientId: optional('AUTH0_CLIENT_ID'),
  auth0ClientSecret: optional('AUTH0_CLIENT_SECRET'),
  auth0Audience: optional('AUTH0_AUDIENCE'),
  helmApiBaseUrl: optional('HELM_API_BASE_URL'),
```

The existing `optional()` already trims and converts blank strings to `undefined`, which is what the second test asserts.

- [ ] **Step 5: Run test to verify it passes**

Run from `helm-app`: `npm test -- env-auth0`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-app
npm test && npm run lint && npx tsc --noEmit
git add lib/server/env.ts test/env-auth0.test.ts
git commit -m "feat(auth): Auth0 and FastAPI base-URL environment contract"
```

---

## Task 2: The Auth0 provider and access-token propagation

The critical correctness point of this whole plan. NextAuth's default JWT callback keeps the **ID token** and drops the **access token**. Only the access token bears the `aud: helm-api` claim FastAPI requires. An ID token presented to FastAPI verifies cryptographically and is then correctly rejected for wrong audience — a failure that looks like broken auth but is actually the wrong token.

**Files:**
- Modify: `helm-app/auth.ts:1-31`
- Create: `helm-app/types/next-auth.d.ts`
- Test: `helm-app/test/auth-token-propagation.test.ts` (create)

**Interfaces:**
- Consumes: `env.auth0Issuer`, `env.auth0ClientId`, `env.auth0ClientSecret`, `env.auth0Audience` (Task 1)
- Produces: `authOptions` whose `jwt` callback stores `accessToken`, `accessTokenExpires`, and `identitySubject`; whose `session` callback exposes `session.accessToken: string | undefined` and `session.user.identitySubject: string | undefined`

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/auth-token-propagation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Account, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { authOptions } from '@/auth'

const jwtCallback = authOptions.callbacks!.jwt!
const sessionCallback = authOptions.callbacks!.session!

const account = {
  provider: 'auth0',
  type: 'oauth',
  providerAccountId: 'auth0|abc123',
  access_token: 'access-token-value',
  id_token: 'id-token-value',
  expires_at: 1_900_000_000,
} as unknown as Account

describe('access token propagation', () => {
  it('stores the ACCESS token, never the id token', async () => {
    const token = (await jwtCallback({
      token: {} as JWT,
      account,
      user: { id: 'auth0|abc123' },
    } as never)) as JWT

    expect(token.accessToken).toBe('access-token-value')
    expect(JSON.stringify(token)).not.toContain('id-token-value')
  })

  it('records the immutable subject as the identity key', async () => {
    const token = (await jwtCallback({
      token: {} as JWT,
      account,
      user: { id: 'auth0|abc123' },
    } as never)) as JWT

    expect(token.identitySubject).toBe('auth0|abc123')
  })

  it('keeps the stored token across calls that carry no account', async () => {
    const first = (await jwtCallback({
      token: {} as JWT,
      account,
      user: { id: 'auth0|abc123' },
    } as never)) as JWT
    const second = (await jwtCallback({ token: first, account: null } as never)) as JWT

    expect(second.accessToken).toBe('access-token-value')
    expect(second.identitySubject).toBe('auth0|abc123')
  })

  it('exposes the access token and subject on the session', async () => {
    const session = (await sessionCallback({
      session: { user: {} } as Session,
      token: {
        sub: 'auth0|abc123',
        accessToken: 'access-token-value',
        identitySubject: 'auth0|abc123',
      } as JWT,
    } as never)) as Session

    expect(session.accessToken).toBe('access-token-value')
    expect(session.user?.identitySubject).toBe('auth0|abc123')
  })

  it('omits the access token when the jwt never carried one', async () => {
    const session = (await sessionCallback({
      session: { user: {} } as Session,
      token: { sub: 'auth0|abc123' } as JWT,
    } as never)) as Session

    expect(session.accessToken).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `helm-app`: `npm test -- auth-token-propagation`
Expected: FAIL — `authOptions.callbacks.jwt` is undefined; only a `session` callback exists today.

- [ ] **Step 3: Declare the session and JWT types**

Create `helm-app/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  /** The Auth0 access token is the only credential FastAPI accepts. */
  interface Session {
    accessToken?: string
    error?: 'token_expired'
    user?: DefaultSession['user'] & {
      id?: string
      /** Immutable Auth0 `sub`. The identity key; email never is. */
      identitySubject?: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    accessTokenExpires?: number
    identitySubject?: string
    error?: 'token_expired'
  }
}
```

- [ ] **Step 4: Add the provider and callbacks**

In `helm-app/auth.ts`, add the import beside the existing provider imports:

```ts
import Auth0 from 'next-auth/providers/auth0'
```

Add this provider registration after the existing Microsoft block, before `export const authOptions`:

```ts
if (env.auth0Issuer && env.auth0ClientId && env.auth0ClientSecret) {
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
```

Replace the `callbacks` block entirely with:

```ts
  callbacks: {
    jwt({ token, account }) {
      // `account` is present only on the sign-in call. Every later call must
      // preserve what was stored then, or the access token vanishes after the
      // first request and every FastAPI call 401s.
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
```

Note what is deliberately absent: refresh-token rotation. Auth0 access tokens default to 24 hours, longer than a working session, and a stale token surfaces as a clean 401 that Task 6 translates into a re-authentication prompt. Adding rotation now would mean storing a refresh token — a credential with no expiry — before Vault/KMS exists (`open-decisions.md` #4). Task 9 records this as a known limitation.

- [ ] **Step 5: Run test to verify it passes**

Run from `helm-app`: `npm test -- auth-token-propagation`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-app
npm test && npm run lint && npx tsc --noEmit
git add auth.ts types/next-auth.d.ts test/auth-token-propagation.test.ts
git commit -m "feat(auth): Auth0 provider carrying the access token into the session"
```

---

## Task 3: Problem-details translation

FastAPI returns RFC 9457 `application/problem+json`. helm-app needs typed errors it can branch on, and must never surface a raw backend body to a user — Stage 1's problem responses are safe by construction, but an unexpected 500 body is not.

**Files:**
- Create: `helm-app/lib/server/helm-api-errors.ts`
- Test: `helm-app/test/helm-api-errors.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `class HelmApiError extends Error` with readonly `status: number`, `code: string`, `retryable: boolean`; `function translateProblem(status: number, body: unknown): HelmApiError`; `const AUTH_CODES: readonly string[]`

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/helm-api-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HelmApiError, translateProblem } from '@/lib/server/helm-api-errors'

describe('problem details translation', () => {
  it('maps each Stage 1 auth code to a typed error', () => {
    const cases = [
      { status: 401, code: 'invalid_token' },
      { status: 403, code: 'insufficient_scope' },
      { status: 403, code: 'no_membership' },
      { status: 400, code: 'tenant_context_required' },
    ]
    for (const { status, code } of cases) {
      const error = translateProblem(status, { code, title: 'x', detail: 'y' })
      expect(error).toBeInstanceOf(HelmApiError)
      expect(error.status).toBe(status)
      expect(error.code).toBe(code)
    }
  })

  it('treats 5xx as retryable and 4xx as not', () => {
    expect(translateProblem(503, { code: 'unavailable' }).retryable).toBe(true)
    expect(translateProblem(403, { code: 'no_membership' }).retryable).toBe(false)
  })

  it('falls back to a safe code when the body is not problem-shaped', () => {
    const error = translateProblem(500, '<html>Internal Server Error</html>')
    expect(error.code).toBe('upstream_error')
    expect(error.message).not.toContain('<html>')
  })

  it('never carries an unexpected body into the message', () => {
    const error = translateProblem(500, { secret: 'postgres://user:pw@host/db' })
    expect(error.message).not.toContain('postgres://')
    expect(JSON.stringify(error)).not.toContain('postgres://')
  })

  it('does not distinguish a missing tenant from a forbidden one', () => {
    const a = translateProblem(403, { code: 'no_membership', detail: 'no access' })
    const b = translateProblem(403, { code: 'no_membership', detail: 'no access' })
    expect(a.message).toBe(b.message)
    expect(a.code).toBe(b.code)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `helm-app`: `npm test -- helm-api-errors`
Expected: FAIL — cannot resolve `@/lib/server/helm-api-errors`.

- [ ] **Step 3: Implement the translation**

Create `helm-app/lib/server/helm-api-errors.ts`:

```ts
import 'server-only'

/** The auth problem codes Stage 1's contract defines. */
export const AUTH_CODES = [
  'invalid_token',
  'insufficient_scope',
  'no_membership',
  'tenant_context_required',
] as const

/**
 * A typed failure from the HELM API.
 *
 * The message is derived only from the problem `code`, never from the raw
 * response body: an unexpected upstream error may contain a connection
 * string or stack trace, and this error is rendered to users.
 */
export class HelmApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean

  constructor(status: number, code: string, retryable: boolean) {
    super(`HELM API request failed (${code})`)
    this.name = 'HelmApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function isProblem(body: unknown): body is { code: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof (body as { code: unknown }).code === 'string'
  )
}

/**
 * Convert a FastAPI response into a typed error.
 *
 * A body that is not problem-shaped collapses to `upstream_error` rather
 * than being echoed, so a raw 5xx page or a driver error never reaches a UI.
 */
export function translateProblem(status: number, body: unknown): HelmApiError {
  const retryable = status >= 500
  const code = isProblem(body) ? body.code : 'upstream_error'
  return new HelmApiError(status, code, retryable)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `helm-app`: `npm test -- helm-api-errors`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-app
npm test && npm run lint && npx tsc --noEmit
git add lib/server/helm-api-errors.ts test/helm-api-errors.test.ts
git commit -m "feat(bff): typed problem-details translation that never echoes upstream bodies"
```

---

## Task 4: The FastAPI HTTP client

The single module that knows FastAPI's URL. Everything else in helm-app goes through it.

**Files:**
- Create: `helm-app/lib/server/helm-api-client.ts`
- Test: `helm-app/test/helm-api-client.test.ts` (create)

**Interfaces:**
- Consumes: `env.helmApiBaseUrl`, `requireServerEnv` (Task 1); `HelmApiError`, `translateProblem` (Task 3)
- Produces: `interface HelmApiRequest { path: string; accessToken: string; tenantHint?: string; signal?: AbortSignal }`; `async function helmApiGet<T>(request: HelmApiRequest): Promise<T>`; `const REQUEST_TIMEOUT_MS: number`

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/helm-api-client.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { helmApiGet } from '@/lib/server/helm-api-client'
import { HelmApiError } from '@/lib/server/helm-api-errors'

const fetchMock = vi.fn()

beforeEach(() => {
  process.env.HELM_API_BASE_URL = 'http://api.test'
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('helmApiGet', () => {
  it('sends the access token as a bearer credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 'token-value' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer token-value')
  })

  it('sends the tenant hint header only when a hint is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't', tenantHint: 'acme' })
    expect(fetchMock.mock.calls[0][1].headers['X-HELM-Active-Tenant']).toBe('acme')

    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[1][1].headers['X-HELM-Active-Tenant']).toBeUndefined()
  })

  it('joins the base URL and path without duplicating slashes', async () => {
    process.env.HELM_API_BASE_URL = 'http://api.test/'
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/tenants')
  })

  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ slug: 'acme' }] }))
    const result = await helmApiGet<{ data: { slug: string }[] }>({
      path: '/api/v1/tenants',
      accessToken: 't',
    })
    expect(result.data[0].slug).toBe('acme')
  })

  it('throws a typed error for a problem response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'no_membership' }, 'application/problem+json'),
    )
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toBeInstanceOf(
      HelmApiError,
    )
  })

  it('never lets an upstream body reach the thrown error', async () => {
    fetchMock.mockResolvedValue(new Response('postgres://user:pw@host/db', { status: 500 }))
    await expect(
      helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }),
    ).rejects.toSatisfy((error: HelmApiError) => !error.message.includes('postgres://'))
  })

  it('turns a network failure into a retryable typed error, not a raw throw', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const error = await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(HelmApiError)
    expect((error as HelmApiError).retryable).toBe(true)
  })

  it('refuses to call without a configured base URL', async () => {
    delete process.env.HELM_API_BASE_URL
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toThrow(
      /helmApiBaseUrl/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `helm-app`: `npm test -- helm-api-client`
Expected: FAIL — cannot resolve `@/lib/server/helm-api-client`.

- [ ] **Step 3: Implement the client**

Create `helm-app/lib/server/helm-api-client.ts`:

```ts
import 'server-only'
import { HelmApiError, translateProblem } from './helm-api-errors'

/** A slow backend must not hold a page render open indefinitely. */
export const REQUEST_TIMEOUT_MS = 10_000

export interface HelmApiRequest {
  /** Absolute path beginning with a slash, e.g. `/api/v1/tenants`. */
  path: string
  /** The Auth0 access token. Never an id token. */
  accessToken: string
  /** Tenant selection hint. A hint only: FastAPI validates it against real membership. */
  tenantHint?: string
  signal?: AbortSignal
}

function resolveBaseUrl(): string {
  const value = process.env.HELM_API_BASE_URL?.trim()
  if (!value) throw new Error('Missing required server environment variable: helmApiBaseUrl')
  return value.replace(/\/+$/, '')
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    // A non-JSON error page is expected from a proxy or a crashed process.
    return undefined
  }
}

/**
 * Perform an authenticated GET against the HELM API.
 *
 * This is the only place in helm-app that knows the API's URL, attaches a
 * credential, or interprets a status code. Failures always surface as
 * HelmApiError, so no caller ever sees a raw upstream body.
 */
export async function helmApiGet<T>(request: HelmApiRequest): Promise<T> {
  const url = `${resolveBaseUrl()}${request.path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${request.accessToken}`,
    Accept: 'application/json',
  }
  if (request.tenantHint) headers['X-HELM-Active-Tenant'] = request.tenantHint

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: request.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    // A DNS failure, refused connection, or timeout is retryable and must not
    // leak the underlying driver message.
    throw new HelmApiError(503, 'upstream_unreachable', true)
  }

  if (!response.ok) {
    throw translateProblem(response.status, await readBody(response))
  }

  return (await response.json()) as T
}
```

`cache: 'no-store'` is deliberate: tenant membership is per-user authorization data, and caching it across requests would let one user's membership list serve another's request.

- [ ] **Step 4: Run test to verify it passes**

Run from `helm-app`: `npm test -- helm-api-client`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-app
npm test && npm run lint && npx tsc --noEmit
git add lib/server/helm-api-client.ts test/helm-api-client.test.ts
git commit -m "feat(bff): authenticated FastAPI client with timeout and safe failures"
```

---

## Task 5: The provisioning command

Stage 1 refuses to auto-create users — a valid token for an unknown subject raises `no_membership`. Correct, but it means the first real human is locked out. This command puts them in deliberately.

**Files:**
- Create: `helm-api/app/cli/__init__.py`
- Create: `helm-api/app/cli/provision.py`
- Test: `helm-api/tests/test_provision_command.py` (create)

**Interfaces:**
- Consumes: `User`, `UserStatus` from `app/db/models/user.py`; `TenantMembership`, `MembershipRole`, `MembershipStatus` from `app/db/models/membership.py`; `Tenant`, `TenantStatus` from `app/db/models/tenant.py`; `AuditRepository`, `AuditEvent` from `app/db/repositories/audit.py` (note: `append(session, context, event)` requires a `TenantContext` and allow-lists metadata keys via `ALLOWED_AUDIT_METADATA_KEYS`); `AuditActorType` from `app/db/models/audit.py`; `TenantContext` from `app/db/tenant_context.py`; `create_database_engine`, `create_session_factory` from `app/db/session.py`
- Produces: `async def provision_member(session, *, issuer: str, subject: str, email: str, tenant_slug: str, role: MembershipRole, display_name: str | None = None) -> ProvisionResult`; frozen dataclass `ProvisionResult` with fields `user_id: UUID`, `membership_id: UUID`, `created_user: bool`
- Note: `User` stores `email_normalized` (not `email`) and requires a non-null `display_name`. `TenantContext` takes `tenant_id: UUID` and optional `user_id: UUID | None`.

- [ ] **Step 1: Write the failing test**

Create `helm-api/tests/test_provision_command.py`:

```python
"""Provisioning is the only way a real person enters HELM; it must be exact."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.cli.provision import provision_member
from app.db.models.membership import MembershipRole, MembershipStatus, TenantMembership
from app.db.models.user import User

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_creates_user_and_membership(provisioned_tenant, session_factory) -> None:
    async with session_factory() as session:
        result = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|abc123",
            email="person@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.OWNER,
        )
        assert result.created_user is True

    async with session_factory() as session:
        user = (
            await session.execute(
                select(User).where(User.identity_subject == "auth0|abc123")
            )
        ).scalar_one()
        assert user.identity_issuer == "https://helm.eu.auth0.com/"
        assert user.email_normalized == "person@agency.test"


@pytest.mark.asyncio
async def test_is_idempotent_for_the_same_identity(provisioned_tenant, session_factory) -> None:
    """Re-running must not create a second user or a duplicate membership."""

    args = dict(
        issuer="https://helm.eu.auth0.com/",
        subject="auth0|abc123",
        email="person@agency.test",
        tenant_slug=provisioned_tenant.slug,
        role=MembershipRole.OWNER,
    )
    async with session_factory() as session:
        first = await provision_member(session, **args)
    async with session_factory() as session:
        second = await provision_member(session, **args)

    assert second.created_user is False
    assert second.user_id == first.user_id
    assert second.membership_id == first.membership_id


@pytest.mark.asyncio
async def test_same_email_different_subject_is_a_different_user(
    provisioned_tenant, session_factory
) -> None:
    """Email is not an identity key: two subjects sharing an address are two users."""

    async with session_factory() as session:
        first = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|first",
            email="shared@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.OWNER,
        )
    async with session_factory() as session:
        second = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|second",
            email="shared@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.ANALYST,
        )

    assert first.user_id != second.user_id


@pytest.mark.asyncio
async def test_unknown_tenant_is_refused(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(LookupError):
            await provision_member(
                session,
                issuer="https://helm.eu.auth0.com/",
                subject="auth0|abc123",
                email="person@agency.test",
                tenant_slug="no-such-tenant",
                role=MembershipRole.OWNER,
            )


@pytest.mark.asyncio
async def test_writes_an_audit_event(provisioned_tenant, session_factory) -> None:
    from app.db.models.audit import AuditLog

    async with session_factory() as session:
        await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|abc123",
            email="person@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.OWNER,
        )

    async with session_factory() as session:
        events = (
            await session.execute(
                select(AuditLog).where(AuditLog.action == "membership.provisioned")
            )
        ).scalars().all()
        assert len(events) == 1
        # AuditRepository rejects metadata keys outside its allow-list, so this
        # asserts the event was built within that contract rather than around it.
        assert set(events[0].metadata_json) <= {"source", "outcome"}


@pytest.mark.asyncio
async def test_membership_is_active_on_creation(provisioned_tenant, session_factory) -> None:
    async with session_factory() as session:
        result = await provision_member(
            session,
            issuer="https://helm.eu.auth0.com/",
            subject="auth0|abc123",
            email="person@agency.test",
            tenant_slug=provisioned_tenant.slug,
            role=MembershipRole.STRATEGIST,
        )

    async with session_factory() as session:
        membership = await session.get(TenantMembership, result.membership_id)
        assert membership is not None
        assert membership.status == MembershipStatus.ACTIVE
        assert membership.role == MembershipRole.STRATEGIST
```

These tests need `session_factory` and `provisioned_tenant`. Stage 1 Task 9 provides `postgres_url` (module-scoped, starts a container and migrates it to head, skipping cleanly without Docker) and `engine`, but defines them inside `tests/test_identity_integration.py` rather than in `conftest.py`. Step 3 moves those two fixtures into `tests/conftest.py` so both test modules share one container, and adds the two this task needs on top.

- [ ] **Step 2: Run test to verify it fails**

Run from `helm-api`: `./.venv/Scripts/python.exe -m pytest tests/test_provision_command.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.cli'`.

- [ ] **Step 3: Share the container fixtures, then add this task's two**

First, **move** the `postgres_url` and `engine` fixtures (and the imports they need: `os`, `subprocess`, `sys`, `Iterator`, `AsyncIterator`, `PostgresContainer`, `create_async_engine`, `AsyncEngine`, `PROJECT_ROOT`, `pytest_asyncio`) out of `tests/test_identity_integration.py` and into `tests/conftest.py`, unchanged. `test_identity_integration.py` keeps working because pytest resolves fixtures from `conftest.py` automatically — delete its now-duplicate definitions rather than leaving two.

Sharing one module-scoped container across both test modules is the point: starting a second Postgres container for provisioning tests would roughly double integration-suite runtime for no benefit.

Then append to `tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """A session factory bound to the containerised test database."""

    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def provisioned_tenant(engine: AsyncEngine) -> Tenant:
    """Create one active tenant for provisioning tests to attach members to.

    The slug is suffixed with a random hex fragment because the container is
    module-scoped: a fixed slug would collide with a row left by an earlier
    test in the same module against the unique index on tenants.slug.
    """

    tenant_id = uuid4()
    slug = f"acme-{tenant_id.hex[:8]}"
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "insert into tenants (id, slug, name, plan, status) "
                "values (:id, :slug, 'Acme', 'test', 'active')"
            ),
            {"id": str(tenant_id), "slug": slug},
        )
    return Tenant(id=tenant_id, slug=slug, name="Acme", status=TenantStatus.ACTIVE)
```

Add the imports this needs at the top of `conftest.py`:

```python
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.db.models.tenant import Tenant, TenantStatus
```

The insert goes through raw SQL rather than the ORM to match how Stage 1's `_seed` creates tenants, including the `plan` column its schema requires.

- [ ] **Step 4: Implement the command**

Create `helm-api/app/cli/__init__.py`:

```python
"""Administrative commands for the HELM control plane."""
```

Create `helm-api/app/cli/provision.py`:

```python
"""Deliberately provision a user and tenant membership, with an audit trail."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models.audit import AuditActorType
from app.db.models.membership import MembershipRole, MembershipStatus, TenantMembership
from app.db.models.tenant import Tenant, TenantStatus
from app.db.models.user import User, UserStatus
from app.db.repositories.audit import AuditEvent, AuditRepository
from app.db.session import create_database_engine, create_session_factory
from app.db.tenant_context import TenantContext


@dataclass(frozen=True, slots=True)
class ProvisionResult:
    """Outcome of a provisioning run."""

    user_id: UUID
    membership_id: UUID
    created_user: bool


async def provision_member(
    session: AsyncSession,
    *,
    issuer: str,
    subject: str,
    email: str,
    tenant_slug: str,
    role: MembershipRole,
    display_name: str | None = None,
) -> ProvisionResult:
    """Create or reuse a user, then grant an active membership in one transaction.

    Idempotent on (issuer, subject) for the user and on (tenant, user) for the
    membership, so re-running is safe. Email is stored for correlation only and
    is never an identity key: two subjects sharing an address are two users.
    """

    tenant = (
        await session.execute(
            select(Tenant).where(Tenant.slug == tenant_slug, Tenant.status == TenantStatus.ACTIVE)
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise LookupError("No active tenant with that slug")

    user = (
        await session.execute(
            select(User).where(User.identity_issuer == issuer, User.identity_subject == subject)
        )
    ).scalar_one_or_none()
    created_user = user is None
    if user is None:
        user = User(
            identity_issuer=issuer,
            identity_subject=subject,
            # The column is `email_normalized`, not `email`: it is stored
            # lowercased for correlation only and is never an identity key.
            email_normalized=email.strip().lower(),
            display_name=display_name or email.split("@")[0],
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.flush()

    membership = (
        await session.execute(
            select(TenantMembership).where(
                TenantMembership.tenant_id == tenant.id,
                TenantMembership.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        membership = TenantMembership(
            tenant_id=tenant.id,
            user_id=user.id,
            role=role,
            status=MembershipStatus.ACTIVE,
        )
        session.add(membership)
        await session.flush()

    await AuditRepository().append(
        session,
        TenantContext(tenant_id=tenant.id),
        AuditEvent(
            actor_type=AuditActorType.SYSTEM,
            actor_id=f"{issuer}#{subject}",
            action="membership.provisioned",
            target=f"tenant_membership:{membership.id}",
            request_id=f"provision-{membership.id}",
            # AuditRepository allow-lists metadata keys and rejects anything
            # outside ALLOWED_AUDIT_METADATA_KEYS, so the role goes in `target`
            # and `source` carries the provenance code. Passing {"role": ...}
            # here would raise ValueError.
            metadata={"source": "cli", "outcome": "created" if created_user else "reused"},
        ),
    )
    await session.commit()
    return ProvisionResult(
        user_id=user.id, membership_id=membership.id, created_user=created_user
    )


def main() -> None:
    """Entry point: python -m app.cli.provision --issuer ... --subject ..."""

    parser = argparse.ArgumentParser(description="Provision a HELM user and membership")
    parser.add_argument("--issuer", required=True)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--tenant", required=True, help="Tenant slug")
    parser.add_argument(
        "--role", required=True, choices=[role.value for role in MembershipRole]
    )
    parser.add_argument("--display-name", default=None, help="Defaults to the email local part")
    args = parser.parse_args()

    async def run() -> None:
        settings = get_settings()
        engine = create_database_engine(settings)
        factory = create_session_factory(engine)
        try:
            async with factory() as session:
                result = await provision_member(
                    session,
                    issuer=args.issuer,
                    subject=args.subject,
                    email=args.email,
                    tenant_slug=args.tenant,
                    role=MembershipRole(args.role),
                    display_name=args.display_name,
                )
            print(
                f"user={result.user_id} membership={result.membership_id} "
                f"created={result.created_user}"
            )
        finally:
            await engine.dispose()

    asyncio.run(run())


if __name__ == "__main__":
    main()
```

Three details verified against the existing code rather than assumed:

- `AuditRepository.append(session, context, event)` requires a `TenantContext`, not a bare tenant id, and it **allow-lists** metadata keys. `ALLOWED_AUDIT_METADATA_KEYS` does not include `role`, so role information belongs in `target`, never in `metadata`.
- `AuditLog`'s columns are `actor_type`, `actor_id`, `action`, `target`, `request_id`, `metadata_json` — there is no `actor_user_id`, `resource_type`, or `resource_id`.
- `create_session_factory(engine)` takes an engine built by `create_database_engine(settings)`; it cannot be called bare.

If `TenantContext`'s constructor requires more than `tenant_id` in the version Stage 1 leaves behind, read `app/db/tenant_context.py` and pass what it declares.

- [ ] **Step 5: Run test to verify it passes**

Run from `helm-api`: `./.venv/Scripts/python.exe -m pytest tests/test_provision_command.py -q`
Expected: PASS, 6 tests (skipped cleanly if Docker is unavailable).

- [ ] **Step 6: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-api
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m mypy app
git add app/cli tests/test_provision_command.py tests/conftest.py
git commit -m "feat(cli): audited, idempotent user and membership provisioning"
```

---

## Task 6: Source the tenant list from FastAPI

The cutover itself. One read moves off Neon.

**Files:**
- Create: `helm-app/lib/server/tenant-directory.ts`
- Test: `helm-app/test/tenant-directory.test.ts` (create)

**Interfaces:**
- Consumes: `helmApiGet` (Task 4); `HelmApiError` (Task 3); `getServerSession`, `authOptions`
- Produces: `interface TenantSummary { id: string; slug: string; name: string; role: string }`; `async function listTenantsFromApi(): Promise<TenantSummary[]>`

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/tenant-directory.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HelmApiError } from '@/lib/server/helm-api-errors'

const helmApiGet = vi.fn()
const getServerSession = vi.fn()

vi.mock('@/lib/server/helm-api-client', () => ({ helmApiGet }))
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/auth', () => ({ authOptions: {} }))

beforeEach(() => {
  helmApiGet.mockReset()
  getServerSession.mockReset()
})

async function subject() {
  return (await import('@/lib/server/tenant-directory')).listTenantsFromApi
}

describe('listTenantsFromApi', () => {
  it('returns the tenants the API reports', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({
      data: [{ id: 'id-1', slug: 'acme', name: 'Acme', role: 'owner' }],
    })

    const list = await (await subject())()
    expect(list).toEqual([{ id: 'id-1', slug: 'acme', name: 'Acme', role: 'owner' }])
  })

  it('passes the session access token to the client', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockResolvedValue({ data: [] })

    await (await subject())()
    expect(helmApiGet).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/tenants', accessToken: 'token-value' }),
    )
  })

  it('returns an empty list when the caller has no membership', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(403, 'no_membership', false))

    await expect((await subject())()).resolves.toEqual([])
  })

  it('refuses to call the API without an access token', async () => {
    getServerSession.mockResolvedValue({ user: {} })

    await expect((await subject())()).rejects.toThrow(/not authenticated/i)
    expect(helmApiGet).not.toHaveBeenCalled()
  })

  it('propagates an unexpected API failure rather than hiding it as empty', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token-value' })
    helmApiGet.mockRejectedValue(new HelmApiError(503, 'upstream_unreachable', true))

    await expect((await subject())()).rejects.toBeInstanceOf(HelmApiError)
  })
})
```

The third and fifth tests draw the distinction that matters: "you have no memberships" is a legitimate empty result, while "the backend is down" must not be silently rendered as an empty tenant list — that would show a user zero tenants and imply their access was revoked.

- [ ] **Step 2: Run test to verify it fails**

Run from `helm-app`: `npm test -- tenant-directory`
Expected: FAIL — cannot resolve `@/lib/server/tenant-directory`.

- [ ] **Step 3: Implement the directory**

Create `helm-app/lib/server/tenant-directory.ts`:

```ts
import 'server-only'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/auth'
import { helmApiGet } from './helm-api-client'
import { HelmApiError } from './helm-api-errors'

export interface TenantSummary {
  id: string
  slug: string
  name: string
  role: string
}

interface TenantListResponse {
  data: TenantSummary[]
}

/**
 * List the signed-in caller's tenants, as the HELM API reports them.
 *
 * This replaces the Phase A path that queried Neon directly. A `no_membership`
 * response is a legitimate empty result; any other failure propagates, because
 * rendering a backend outage as "you belong to no tenants" would look
 * identical to having access revoked.
 */
export async function listTenantsFromApi(): Promise<TenantSummary[]> {
  const session = await getServerSession(authOptions)
  const accessToken = session?.accessToken
  if (!accessToken) throw new Error('The caller is not authenticated')

  try {
    const response = await helmApiGet<TenantListResponse>({
      path: '/api/v1/tenants',
      accessToken,
    })
    return response.data
  } catch (error) {
    if (error instanceof HelmApiError && error.code === 'no_membership') return []
    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `helm-app`: `npm test -- tenant-directory`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-app
npm test && npm run lint && npx tsc --noEmit
git add lib/server/tenant-directory.ts test/tenant-directory.test.ts
git commit -m "feat(bff): source the tenant list from FastAPI instead of Neon"
```

---

## Task 7: Migrate `middleware.ts` to the `proxy` convention

Next.js 16.2.10 deprecates the `middleware` file convention in favour of `proxy`. This is verified from `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` §"`middleware` to `proxy`", not assumed. Doing it now — while auth is already being touched — avoids a second pass over the same file.

**Files:**
- Create: `helm-app/proxy.ts`
- Delete: `helm-app/middleware.ts`
- Test: `helm-app/test/proxy-matcher.test.ts` (create)

**Interfaces:**
- Consumes: `withAuth` from `next-auth/middleware`
- Produces: default export `proxy`; `export const config` with the unchanged matcher

- [ ] **Step 1: Confirm the deprecation before changing anything**

Run from `helm-app`:

```bash
grep -n "middleware. to .proxy" node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md
```

Expected: a match at the `## middleware to proxy` heading. If this file or heading is absent, **stop** — the installed Next version does not carry this rename and this task must not proceed.

The same section states the `proxy` runtime is Node.js and cannot be configured to `edge`. The existing middleware sets no runtime, so nothing here depends on edge.

- [ ] **Step 2: Write the failing test**

Create `helm-app/test/proxy-matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { config } from '@/proxy'

const matcher = new RegExp(config.matcher[0])

describe('proxy matcher', () => {
  it('protects application routes', () => {
    for (const path of ['/campaigns', '/studio', '/approvals', '/api/tenant/switch']) {
      expect(matcher.test(path)).toBe(true)
    }
  })

  it('exempts auth, health, login and no-access', () => {
    for (const path of ['/api/auth/signin', '/api/auth/callback/auth0', '/api/health', '/login', '/no-access']) {
      expect(matcher.test(path)).toBe(false)
    }
  })

  it('still protects routes that merely start with an exempt name', () => {
    for (const path of ['/login-history', '/api/authenticate']) {
      expect(matcher.test(path)).toBe(true)
    }
  })
})
```

The third test preserves the segment-boundary anchoring the existing `middleware.ts` comment explains at length. A rename must not quietly weaken it.

- [ ] **Step 3: Run test to verify it fails**

Run from `helm-app`: `npm test -- proxy-matcher`
Expected: FAIL — cannot resolve `@/proxy`.

- [ ] **Step 4: Rename the file**

Run from `helm-app`:

```bash
git mv middleware.ts proxy.ts
```

Then in `proxy.ts`, replace the default export line so the function carries the new name:

```ts
import withAuth from 'next-auth/middleware'

/**
 * Renamed from `middleware.ts`: Next.js 16 deprecates the `middleware` file
 * convention in favour of `proxy`. The import path `next-auth/middleware` is
 * NextAuth's own module name and is unrelated to the Next.js convention, so it
 * stays as it is.
 */
const proxy = withAuth({ pages: { signIn: '/login' } })

export default proxy
```

Leave the entire matcher comment block and `export const config` exactly as they are. The rename changes the file's name and the exported function's name, nothing about the routing behaviour.

- [ ] **Step 5: Run test to verify it passes**

Run from `helm-app`: `npm test -- proxy-matcher`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify the app still builds and protects routes**

```bash
cd F:/Codes/HELM/helm-app
npx next build
```

Expected: build succeeds with no warning about a deprecated `middleware` convention.

- [ ] **Step 7: Run the gates and commit**

```bash
cd F:/Codes/HELM/helm-app
npm test && npm run lint && npx tsc --noEmit
git add proxy.ts test/proxy-matcher.test.ts
git rm --cached middleware.ts 2>/dev/null || true
git commit -m "refactor: migrate middleware.ts to the Next 16 proxy convention"
```

---

## Task 8: Wire FastAPI to Auth0 and verify end to end

Everything built so far is unit-tested against fixtures. This task connects the real pieces and proves a human can sign in.

**Files:**
- Modify: `helm-api/.env.example`
- Create: `helm-app/.env.local.example`
- Create: `docs/runbooks/auth0-setup.md`

**Interfaces:**
- Consumes: `Settings.require_oidc()` from Stage 1 Task 1
- Produces: no code interfaces; this task closes the sub-project

- [ ] **Step 1: Record the FastAPI environment values**

Append to `helm-api/.env.example`:

```
# Auth0. FastAPI never learns these are Auth0 values -- swapping issuers is a
# configuration change, never a code change.
OIDC_ISSUER=https://your-account.eu.auth0.com/
OIDC_JWKS_URL=https://your-account.eu.auth0.com/.well-known/jwks.json
OIDC_AUDIENCE=helm-api
OIDC_ALLOWED_ALGORITHMS=["RS256"]
```

`OIDC_ISSUER` must include the trailing slash. Auth0's `iss` claim carries one, and Stage 1's verifier compares the issuer exactly — a missing slash produces a token that verifies cryptographically and is then rejected for wrong issuer.

- [ ] **Step 2: Record the helm-app environment values**

Create `helm-app/.env.local.example`:

```
AUTH_SECRET=generate-with-openssl-rand-base64-32
AUTH0_ISSUER=https://your-account.eu.auth0.com
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_AUDIENCE=helm-api
HELM_API_BASE_URL=http://localhost:8000
NEON_DATABASE_URL=postgresql://helm_app:...
```

Note the asymmetry, which is deliberate and easy to get wrong: `AUTH0_ISSUER` here has **no** trailing slash (NextAuth appends paths to it), while `OIDC_ISSUER` in FastAPI **does** (it is compared against the `iss` claim verbatim).

- [ ] **Step 3: Repoint the database role**

The Phase A boot guard `assertRuntimeRoleCannotBypassRls` refuses to serve tenant-scoped queries through the RLS-bypassing `neondb_owner` role, so no real data renders until this is done.

```bash
cd F:/Codes/HELM/helm-app
npm run db:provision-app-role
```

Then set `NEON_DATABASE_URL` in `.env.local` to the `helm_app` role's connection string.

- [ ] **Step 4: Provision yourself**

Sign in to the app once. The attempt will fail with `no_membership` — expected, because Stage 1 does not auto-provision. Retrieve your Auth0 `sub` from the Auth0 dashboard (User Management → Users → your user → `user_id`).

Then, from `helm-api`:

```bash
./.venv/Scripts/python.exe -m app.cli.provision \
  --issuer "https://your-account.eu.auth0.com/" \
  --subject "auth0|your-subject-id" \
  --email "you@example.com" \
  --tenant "acme" \
  --role owner
```

The `--issuer` value must match `OIDC_ISSUER` exactly, trailing slash included: identity is keyed on `(identity_issuer, identity_subject)`, so a mismatched issuer creates a user the verifier will never find.

- [ ] **Step 5: Verify the full path**

Start both services, then sign in.

```bash
# terminal 1
cd F:/Codes/HELM/helm-api && ./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
# terminal 2
cd F:/Codes/HELM/helm-app && npm run dev
```

Confirm each of these, and treat any failure as a defect in an earlier task rather than something to work around here:

1. Signing in redirects to Auth0 and back.
2. The tenant list renders your real tenant, fetched from FastAPI.
3. FastAPI's log shows a request to `GET /api/v1/tenants` with a 200.
4. An `audit_log` row exists for the tenant-list read.
5. Stopping FastAPI and reloading surfaces an error state — **not** an empty tenant list.

Point 5 is the one worth checking deliberately: it proves Task 6's distinction between "no membership" and "backend down" survives into the running app.

- [ ] **Step 6: Write the runbook**

Create `docs/runbooks/auth0-setup.md` recording: the Auth0 API identifier and application type, the two issuer formats and why they differ, the callback URLs, the provisioning command with a worked example, and the five verification checks above.

Include a **Known limitations** section stating plainly:

- No refresh-token rotation. When an Auth0 access token expires (24h default), the caller must sign in again. Rotation is deferred until Vault/KMS exists (`open-decisions.md` #4), because storing a refresh token means storing a credential that does not expire.
- Phase A's `resolveMembership(email)` in `lib/server/tenant-session.ts` still keys identity on email, which `auth-contract.md` forbids. It is **not** changed here: campaigns and approvals still depend on it, and migrating it belongs with their endpoint cutover. The new FastAPI path keys correctly on `(issuer, subject)`. Until that cutover, two identity paths coexist — this is the temporary seam the spec names.
- Phase A's scope vocabulary (`analytics.read`, `campaigns.write`) differs from Stage 1's (`campaign:read`, `approval:decide`). They are separate systems and must not be conflated; the FastAPI vocabulary is the one that survives.

- [ ] **Step 7: Commit**

```bash
cd F:/Codes/HELM
git add helm-api/.env.example helm-app/.env.local.example docs/runbooks/auth0-setup.md
git commit -m "docs(auth): Auth0 setup runbook and environment templates"
```

---

## Definition of done

A real person signs in through Auth0 and helm-app renders their tenant list from `GET /api/v1/tenants` — verified by a real JWT, scoped by RLS, with an audit event written. FastAPI contains no Auth0-specific code.

All gates green:

- `helm-api`: `pytest`, `ruff check`, `mypy app`
- `helm-app`: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx next build`

## What this sub-project deliberately leaves open

- Campaigns and approvals still query Neon directly through the email-keyed Phase A path.
- No refresh-token rotation.
- No self-serve invitation lifecycle (`open-decisions.md` #8).
- Provider credentials remain in environment variables (`open-decisions.md` #4).

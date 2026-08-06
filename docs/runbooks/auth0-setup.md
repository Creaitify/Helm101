# Auth0 setup — the manual step that unblocks Tasks 2 and 8

**Status:** awaiting the dashboard step below. Everything else in the Auth0/BFF cutover
is built and reviewed on branch `feat/auth0-bff-cutover`.

This is the one part of the cutover no agent can do: creating an Auth0 API and
application produces a client secret that must be generated interactively.

## 1. Create the API

Auth0 dashboard → **Applications → APIs → Create API**

| Field | Value |
|---|---|
| Name | `HELM API` |
| Identifier | `helm-api` |
| Signing algorithm | **RS256** |

The identifier must be exactly `helm-api`. It becomes both `AUTH0_AUDIENCE` in
`helm-app` and `OIDC_AUDIENCE` in `helm-api`, and all three must match.

RS256 is not optional. Stage 1's config validator refuses symmetric algorithms at
startup, deliberately: allowing `HS256` alongside an RSA JWKS is the classic
algorithm-confusion vector, where an attacker signs a token using the *public* key as an
HMAC secret. HS256 here would fail FastAPI's boot.

## 2. Create the application

**Applications → Create Application**

| Field | Value |
|---|---|
| Name | `HELM Web` |
| Type | **Regular Web Application** |

Then in its Settings:

| Field | Value |
|---|---|
| Allowed Callback URLs | `http://localhost:3000/api/auth/callback/auth0` |
| Allowed Logout URLs | `http://localhost:3000` |

Record the domain, client id, and client secret.

## 3. Fill in `helm-app/.env.local`

```
AUTH0_ISSUER=https://YOUR-TENANT.REGION.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_AUDIENCE=helm-api
HELM_API_BASE_URL=http://localhost:8000
```

`.env.local` is git-ignored and already holds your real database values. Never commit it.
`helm-app/.env.example` carries these same keys with empty values and inline notes.

All four `AUTH0_*` values are required together. If `AUTH0_AUDIENCE` is missing the
provider deliberately refuses to register, rather than requesting `audience: undefined`
and receiving an opaque token that no JWKS can verify. A missing-config failure at
startup is worth far more than a 401 at first login that reads as broken auth.

## 4. Fill in `helm-api/.env`

This file does not exist yet. Copy the template rather than writing one, so you
inherit the database and CORS entries too:

```bash
cd helm-api && cp .env.example .env
```

Then set the OIDC block (`OIDC_AUDIENCE` and `OIDC_ALLOWED_ALGORITHMS` already
carry the right defaults):

```
OIDC_ISSUER=https://YOUR-TENANT.REGION.auth0.com/
OIDC_JWKS_URL=https://YOUR-TENANT.REGION.auth0.com/.well-known/jwks.json
```

`DATABASE_URL` must also be set, as a role that **cannot** bypass RLS — never
`neondb_owner`, whose `rolbypassrls` silently disables tenant isolation.

## 5. Check the configuration before trying to log in

```bash
cd helm-api && ./.venv/Scripts/python.exe -m app.cli.preflight
```

This validates what it can without contacting Auth0 — that all four `AUTH0_*`
values are present, that the issuer and JWKS URL share an origin, that the
trailing-slash asymmetry between the two services is correct, and that the
audiences match. It reports key names and mismatches, never values.

A clean preflight does not guarantee login works, but a failing one guarantees it
will not, and tells you exactly which line to fix.

## The trailing-slash asymmetry

This is the detail most people get wrong, and the failure it produces is confusing —
a token that verifies cryptographically and is then rejected for wrong issuer.

- **`AUTH0_ISSUER` (helm-app): NO trailing slash.** NextAuth appends discovery paths to it.
- **`OIDC_ISSUER` (helm-api): trailing slash REQUIRED.** Auth0's `iss` claim carries one,
  and Stage 1's verifier compares the issuer verbatim.

## What happens next

Once those values are in place, Tasks 2 and 8 can run:

- **Task 2** adds the Auth0 provider to `auth.ts` and carries the **access token** (not the
  ID token) into the session. Only the access token bears the `aud: helm-api` claim
  FastAPI requires; an ID token presented to FastAPI is correctly rejected as
  wrong-audience. Task 2 must also remove the temporary cast at
  `helm-app/lib/server/tenant-directory.ts:28`, which exists only because the session
  type augmentation doesn't land until then.
- **Task 8** wires both services, provisions you as a real user, and verifies sign-in end
  to end.

## Provisioning yourself

Signing in before provisioning will fail with `no_membership`. That is correct — Stage 1
never auto-creates users from a token, because implicit provisioning is how tenants
acquire members nobody decided to add.

Get your Auth0 `sub` from **User Management → Users → your user → `user_id`**, then from
`helm-api/`:

```bash
./.venv/Scripts/python.exe -m app.cli.provision \
  --issuer "https://YOUR-TENANT.REGION.auth0.com/" \
  --subject "auth0|your-subject-id" \
  --email "you@example.com" \
  --tenant "your-tenant-slug" \
  --role owner
```

`--issuer` must match `OIDC_ISSUER` exactly, trailing slash included. Identity is keyed on
`(identity_issuer, identity_subject)`, so a mismatched issuer creates a user the verifier
will never find.

## Verification checklist

1. Sign-in redirects to Auth0 and back.
2. The tenant list renders your real tenant, fetched from FastAPI.
3. FastAPI's log shows `GET /api/v1/tenants` returning 200.
4. An `audit_log` row exists for the tenant-list read.
5. **Stop FastAPI and reload.** You must see an error state — *not* an empty tenant list.

Point 5 is worth checking deliberately. It proves the BFF distinguishes "you have no
memberships" from "the backend is down." Rendering an outage as zero tenants looks
identical to having your access revoked, and would send a user to support for what is
actually a 503.

## Known limitations at this stage

- **No refresh-token rotation.** When an Auth0 access token expires (24h default) the user
  must sign in again. Rotation is deferred until Vault/KMS exists
  (`open-decisions.md` #4), because storing a refresh token means storing a credential
  that does not expire.
- **Two identity paths coexist.** Phase A's `lib/server/tenant-session.ts` still keys on
  email, which `auth-contract.md` forbids. It is not changed here because campaigns and
  approvals depend on it; migrating it belongs with their own cutover. The new FastAPI
  path keys correctly on `(issuer, subject)`.
- **Two scope vocabularies.** Phase A uses `analytics.read` / `campaigns.write`; Stage 1
  uses `campaign:read` / `approval:decide`. They are separate systems and must not be
  conflated. The FastAPI vocabulary is the one that survives.

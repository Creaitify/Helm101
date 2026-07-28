# HELM Authentication and Authorization Contract (Stage 0)

## Decision

Use a shared OIDC issuer for the future Vercel BFF and FastAPI. Browser login/OAuth callback/session mechanics belong to the BFF. FastAPI is an OAuth resource server: it validates a bearer access token itself and resolves HELM authorization from Neon. It never accepts a BFF session cookie as proof of authorization.

### Production design pending confirmation

The current NextAuth configuration (`session: { strategy: "jwt" }`) is **not** automatically a standards-compliant OIDC/JWKS-verifiable access-token issuer for FastAPI. Likewise, tokens received from Google or Microsoft during a provider login are not, by themselves, HELM FastAPI resource tokens. Do not implement HELM authentication until senior/backend and frontend owners confirm one of these production designs:

1. Use a shared standards-compliant OIDC issuer that issues FastAPI-audience user access tokens; or
2. Have the Vercel BFF mint short-lived, private-key-signed user-delegation JWTs for FastAPI and expose the corresponding JWKS endpoint for FastAPI verification.

In either design, the BFF workload/service assertion is additional service authentication only. It does not replace the user delegation/access token and cannot authorize a request by itself.

For local and test development before the BFF exists, **Keycloak via Docker** is the recommended temporary, self-controlled OIDC provider. Its realm/client setup must exercise the complete production-shaped flow: token → JWT verification → global user resolution → tenant membership → effective scopes → RLS tenant context. Docker/Keycloak provisioning is explicitly deferred by team decision and is not part of Stage 1. Auth0 is a managed alternative, not a self-controlled provider.

FastAPI verification is provider-agnostic and configuration-driven through `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_AUDIENCE`, and `OIDC_ALLOWED_ALGORITHMS`. The final production user-token design remains pending confirmation. It can change without FastAPI code changes if it provides standards-compliant OIDC discovery/JWKS and the configured claims contract, including the BFF-delegation-JWT alternative above.

## Token contract

FastAPI accepts short-lived JWT access tokens over TLS only. It validates signature against the configured issuer JWKS; exact `iss`, `aud`, `exp`, `nbf`, `iat`, configured algorithm allow-list, and a stable subject (`sub`). It rejects tokens without a verified subject. Access tokens are not stored in browser local storage.

Required standard claims: `iss`, `sub`, `aud`, `exp`, `iat`, `jti`. Recommended HELM context claims: `email` (for provisioning correlation only), `azp`/`client_id`, and `sid` where issuer supports session revocation. Do **not** put roles, scopes, raw tenant ids, permissions, or credentials in a browser token as authoritative data.

In production, the BFF sends `Authorization: Bearer <access-token>` **and** a signed BFF workload/service assertion. Both are required. It may supply `X-HELM-Active-Tenant` only as a tenant-selection hint. FastAPI verifies the caller has an active membership in that tenant; an absent selection can be resolved only where the endpoint defines a safe default (for example, a tenant chooser), otherwise return `tenant_context_required`.

### Development-only BFF assertion bypass

In `local` and `test` environments only, FastAPI may accept a valid user OIDC token without the BFF assertion. This exists solely to allow local API and worker development before the BFF is available. It is not an unrestricted bypass: the token must still validate against the configured development issuer, `OIDC_JWKS_URL`, audience, signature-algorithm allow-list, expiry/not-before times, and subject requirements; FastAPI still resolves membership, scopes, and RLS context exactly as above.

The bypass must be explicit configuration, default to disabled, and cause a **startup hard failure** if enabled in `staging` or `production`. No environment may bypass user-token validation.

## FastAPI authorization sequence

1. Authenticate the JWT and identify the issuer subject.
2. Load the active global user by immutable issuer + `sub` (email is not an identity key).
3. Resolve an active `tenant_membership` for the requested tenant.
4. Compute effective scopes using server-held role defaults plus approved membership grants/restrictions.
5. Establish transaction-local tenant context for all tenant data access.
6. Enforce endpoint/action scope and policy before performing work; audit sensitive allow/deny decisions.

The API returns `401` for invalid/missing identity, `403` for a valid identity lacking membership/scope, and `404` only when resource non-disclosure policy is explicitly intended. It never trusts an incoming role, scope, tenant name, or user id.

## Data model direction

```text
users(id, identity_issuer, identity_subject, email_normalized, ...)
tenant_memberships(id, tenant_id, user_id, role, status, scope_grants, scope_restrictions, ...)
```

`users` is global. `tenant_memberships` is the authorization relation. A single person can be a strategist for one tenant and a client viewer for another. Invitations create pending membership records bound to an email/identity-verification flow; accepting one must not grant access to another tenant. Membership suspension immediately blocks backend access irrespective of an unexpired browser token.

## Service authentication

BFF-to-FastAPI calls additionally require a short-lived signed service assertion (JWT client assertion or mTLS-bound identity) whose audience is FastAPI and whose client is the specific BFF deployment. This is service authentication, not a substitute for user authorization. The only exception is the explicitly configured `local`/`test` development bypass above. Workers, MCP services, and gateway services use separate workload identities with least-privilege audiences/scopes; no shared static internal bearer token.

## Lifecycle controls

Provision/deprovision and role changes happen through FastAPI administrative commands and are audited. FastAPI maintains a bounded identity/membership cache only with explicit invalidation/revocation handling. MFA/step-up requirements for high-risk actions are evaluated by FastAPI from an issuer assurance claim or an explicit recent-authentication record; the BFF cannot simply assert that step-up occurred.

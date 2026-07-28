# FastAPI ↔ Vercel BFF Contract (Stage 0)

## Boundary

The BFF is a thin frontend-facing adapter. FastAPI is the authoritative API and control plane. The BFF owns browser OAuth redirects/callbacks, secure session-cookie lifecycle, CSRF protections for its browser endpoints, and UI-oriented response aggregation/proxying. It may not own or independently mutate memberships, roles, scopes, tenant authorization, audit records, approvals, integration state, business data, model policy, or usage/budget state.

The BFF must not query Neon directly, access R2 credentials, invoke model providers/MCP servers, or call worker/LangGraph internals. Every backend mutation travels through FastAPI.

## API shape

FastAPI publishes versioned HTTPS APIs under `/api/v1`. The BFF is a documented client, not a private database adapter. Use resource-oriented reads and explicit command endpoints for side effects, for example:

- `GET /api/v1/tenants`, `GET /api/v1/campaigns`, `GET /api/v1/approvals`
- `POST /api/v1/approvals/{id}:decide`
- `POST /api/v1/creative-jobs`, `GET /api/v1/jobs/{id}`
- `POST /v1/integrations/{kind}:connect`, `POST /v1/integrations/{id}:disconnect`

In production, requests carry `Authorization: Bearer <OIDC user access token>`, a signed BFF workload assertion, `X-Request-Id`, and for mutations an `Idempotency-Key`. FastAPI requires and independently validates both identity proofs. `X-HELM-Active-Tenant` is an untrusted selection hint, not authorization. The server returns `X-Request-Id` and version/deprecation headers. Cursor pagination, filtering, sort fields, and response schemas are documented in OpenAPI and treated as compatibility contracts.

## Envelope and errors

Successful responses return the resource or `{ "data": ... , "meta": ... }` for collections. Errors use RFC 9457 Problem Details:

```json
{
  "type": "https://api.helm.example/problems/insufficient-scope",
  "title": "Forbidden",
  "status": 403,
  "code": "insufficient_scope",
  "request_id": "..."
}
```

No error reveals secrets, cross-tenant resource existence, policy internals, or raw provider errors. Commands returning async work use `202 Accepted` with a job/operation resource, not an open request connection.

## Identity, claims, and tenant handling

The BFF forwards identity and lets FastAPI resolve current user and membership. It may display a tenant selector from `GET /v1/tenants`, but must refresh it from FastAPI after switches or authorization changes. The FastAPI response may include a non-authoritative `context` presentation object (active tenant id, membership id, role, effective scopes) for UI gating; the BFF must still call FastAPI for enforcement and must not cache it beyond its declared freshness.

The precise production user-token issuer remains pending senior/frontend confirmation. NextAuth JWT sessions and upstream Google/Microsoft provider tokens must not be presented as FastAPI resource tokens merely because they are JWTs or provider credentials. The BFF must either forward a user access token from the shared standards-compliant OIDC issuer, or mint a short-lived private-key-signed user-delegation JWT with a FastAPI-verifiable JWKS endpoint. Its separate workload assertion authenticates the BFF service and is never a replacement for the delegated user identity.

## Service-to-service protections

Use TLS, issuer/audience/JWKS/signature-algorithm validation for user JWTs, and a separate short-lived BFF workload identity (mTLS or signed client assertion). FastAPI applies rate limits keyed by tenant/user/service; it does not rely on the BFF for limits. Configure bounded timeouts, retry only idempotent reads or idempotency-keyed commands, and propagate trace/correlation ids. Internal endpoints are not exposed through the BFF unless explicitly designed as FastAPI public API.

For local and test API/worker development before the BFF exists, FastAPI may omit the workload-assertion requirement only when an explicit development bypass is enabled. The user OIDC token remains mandatory and must validate against the configured development issuer, JWKS URL, audience, allowed algorithms, expiry, and subject. FastAPI must fail startup when this bypass is enabled in staging or production; it is never a browser/session or authorization bypass.

## Non-duplication rules

The BFF can translate UI requests, aggregate stable FastAPI resources, and reshape presentation data. It cannot reimplement authorization policy, write audit entries, construct tenant context, make approval decisions locally, retry side-effecting operations without idempotency, or persist a competing copy of HELM data. FastAPI emits domain events/outbox records; the BFF never invents business events.

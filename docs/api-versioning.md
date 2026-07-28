# HELM API Versioning and Compatibility Standard

## Authority and public base path

FastAPI publishes HELM's public backend API under `/api/v1`. The generated OpenAPI document is the authoritative API contract for the future Vercel BFF and frontend. FastAPI remains authoritative for resource semantics, authorization outcomes, errors, and lifecycle behavior; the BFF is a client and must not rely on undocumented response fields, ordering, defaults, or implementation details.

## Versioning policy

`/api/v1` is a compatibility commitment. HELM will not silently break it. A future breaking API uses a new major path such as `/api/v2`, with a separately versioned OpenAPI contract.

Backward-compatible changes include adding optional response fields, adding new endpoints, adding optional query parameters, and adding new values only where the contract expressly permits unknown values. Renaming or removing a field, changing its type/meaning/default, tightening accepted input, changing authorization or error semantics, or changing pagination/filter/sort behavior is breaking. It requires a new version or an explicitly documented deprecation and migration path that preserves existing `/api/v1` behavior for the published window.

## Request and response conventions

- Collection endpoints use cursor pagination. Requests use an explicit cursor and bounded `limit`; responses provide `data` and `meta` with a next cursor when more results exist.
- Filtering and sorting are explicit, documented query parameters. Unsupported fields, operators, or sort directions are rejected with a problem-details error rather than ignored.
- Mutations require `Idempotency-Key` where a retry could otherwise duplicate a side effect. Idempotency scope, expiry, and replay response behavior are documented per endpoint.
- Every response includes `X-Request-Id`. Clients propagate it when supplied and use it for support and incident correlation.
- Errors use RFC 9457 Problem Details (`application/problem+json`), including stable machine-readable error codes. No errors expose secrets, cross-tenant existence, or internal provider details.

## Deprecation and migration

When a supported version or field is deprecated, FastAPI includes `Deprecation: true` and a `Sunset` HTTP-date header on affected responses, plus a `Link` header pointing to the migration guidance. The OpenAPI contract and release notes identify the replacement and the exact removal date.

The normal deprecation window is at least **180 days** after notice for a public version/field. Security, legal, or critical data-integrity incidents may require a shorter window; the exception, impact, and replacement path must be communicated to affected tenants. A major version remains available through its announced sunset date, subject to these emergency exceptions.

## BFF/client obligations

The BFF consumes only documented OpenAPI operations and schemas, handles additive fields safely, honors deprecation headers, and migrates before sunset. It must not replicate backend policy or build a dependency on database schema, internal endpoints, or unversioned behavior. Contract changes are reviewed through OpenAPI diffs before release.

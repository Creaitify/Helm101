# HELM Stage 0 Open Decisions and Risks

## Decisions requiring team confirmation before Stage 1

1. **Production user-token design:** senior/frontend owners must choose either a shared standards-compliant OIDC issuer or BFF-minted, private-key-signed user-delegation JWTs with a FastAPI-verifiable JWKS endpoint. Confirm FastAPI audience, JWKS/revocation behavior, MFA/step-up claims, and BFF service-assertion approach. NextAuth JWT sessions and Google/Microsoft provider tokens are not automatically FastAPI resource tokens.
2. **Data residency and retention:** choose approved Neon/R2/queue regions, DPDP roles/processes, retention schedules, legal holds, backup deletion behavior, and vendor data-processing terms.
3. **Queue and worker platform:** select queue/outbox implementation, worker hosting, DLQ/alerting, concurrency quotas, and recovery objectives.
4. **Vault/KMS:** a dedicated vault/KMS is deferred and not implemented. Select its service, key hierarchy/rotation, migration from Railway/Vercel environment-secret-held AES-256-GCM key material, integration-token encryption, and break-glass access procedure.
5. **Production IdP:** select the final OIDC issuer, BFF workload-assertion mechanism, token assurance claims, and revocation posture. Keycloak via Docker is the temporary self-controlled local/test provider.
6. **Agent hosting:** managed LangGraph versus self-hosted/container runtime, checkpoint schema/retention, and human-interrupt resume model.
7. **Autonomy policy:** define concrete action tiers, spend caps, approval delegation/separation-of-duties, kill-switch authority, and policy versioning.
8. **Canonical schema:** approve the global-user plus tenant-membership migration plan, membership invitation lifecycle, agency/client visibility model, and resource-level client-safe filters.
9. **Model/provider policy:** approve models, allowed data classes per provider, regional processing, provider fallback behavior, cost pricing source, and incident response for guardrail failures. The gateway starts in-process as an internal FastAPI module with an extraction-ready boundary; its placement is no longer open.
10. **R2 residency acceptance:** Cloudflare R2 will use an APAC location hint, but it does not guarantee Singapore residency. Compliance must confirm the resulting data-residency posture and any tenant-specific restrictions.

## Risks found in current material

- `users.tenant_id` prevents legitimate multi-client agency access and conflates identity with membership.
- The prototype has a second role vocabulary (`master`, `agency`, `viewer`) that conflicts with database/gateway roles.
- Existing RLS covers only a small initial table subset; a production schema needs tenant keys/RLS on every tenant-owned table and a clear global-table policy.
- The current gateway routes from environment variables and has no real adapters, budget ledger enforcement, provider isolation, cache/retry policy, or durable usage/audit transaction.
- Regex-only PII/injection/compliance checks are insufficient for DPDP/SEBI requirements and must not be represented as production assurance.
- The architecture requires a durable agent and async creative runtime, but no queue/outbox, worker, webhook inbox, or idempotency design has yet been chosen.
- Auth.js session configuration is not a backend authorization contract; FastAPI must validate independently as specified in `auth-contract.md`.

## Recommended Stage 1 start point

Begin with the **identity, tenancy, and transaction-security foundation** in FastAPI: establish the Python project boundary and configuration validation; implement OIDC JWT verification; define `users` + `tenant_memberships` and canonical roles/scopes; create a scoped repository/unit-of-work that sets RLS tenant context; and implement append-only audit plus request/correlation/idempotency primitives. Do not start campaigns, gateway adapters, agents, integrations, or BFF endpoints until these primitives have security tests for cross-tenant denial, revoked/suspended membership, scope denial, and audit atomicity.

## Stage 1 status (2026-07-30)

Implemented in `helm-api` and verified by:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy app
```

Closed:

- OIDC JWT verification against a configured JWKS, provider-agnostic
- Global `users` + `tenant_memberships` resolution with no auto-provisioning
- Six canonical roles with pure, ceiling-capped scope arithmetic
- Transaction-local RLS tenant context on every tenant-scoped query
- Append-only audit with atomicity proven under rollback
- Tenant-scoped idempotency key ledger
- Membership resolution before tenant context exists, proven under a
  non-bypass role

Still open and deliberately untouched: items 1 and 5 (the production issuer
choice), 2, 3, 4, 6, 7, 9 and 10. Item 8's canonical schema is now implemented
for identity and membership; its invitation lifecycle and client-safe resource
filters remain open.

The `users.tenant_id` risk listed above is resolved in `helm-api`, whose schema
uses global users plus memberships. It remains true of `helm-app`, which keeps
its own prototype database until the sub-project 3 BFF cutover.

### Resolved: membership resolution under non-bypass roles

`IdentityRepository.list_active_memberships` queries FORCE-RLS tables
(`tenant_memberships`, `tenants`) before the connection's tenant context is
set, since selecting the tenant is the point of the query. It now does this
through `helm_lookup_active_memberships`
(`alembic/versions/20260805_04_membership_lookup_function.py`), a narrow,
parameterised `SECURITY DEFINER` function keyed on
`(identity_issuer, identity_subject)` — adapting the precedent in
`helm-app/db/migrations/0008_membership_lookup_all.sql`, but keyed on the
issuer/subject pair rather than email, per the identity-key rule above. The
function is revoked from `public`, granted only to the application role, and
returns only the passed identity's own active memberships in active tenants.
The production request path in `app/api/deps.py::current_caller` now resolves
memberships correctly under a real non-bypass role.

The test, formerly `test_membership_resolution_under_non_bypass_role_is_a_known_gap`
(xfail, strict=True), is renamed
`test_membership_resolution_works_under_non_bypass_role` and now passes
un-xfailed in `tests/test_identity_integration.py`. A second test,
`test_membership_lookup_function_never_leaks_across_identities`, proves the
function returns only the passed identity's own memberships and never another
user's.

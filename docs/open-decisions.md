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

# HELM Post-Cleanup Audit and Corrected Production Roadmap

Date: 2026-08-12  
Branch reviewed: `anzar`  
Blueprint reviewed: `HELM_Technical_Blueprint.pdf`, version 1.0, August 2026  
Audit scope: Git history, current committed code, uncommitted demo work, local verification, and validation of the blueprint against current primary sources.

## Executive conclusion

Do not revert the cleanup commit wholesale.

The cleanup made the correct architectural move: it retained the hardened FastAPI identity/RLS/audit foundation, retained the frontend presentation layer, consolidated the repository into `api/`, `web/`, `workers/`, and `docs/`, and removed the duplicate frontend database/auth spine and toy gateway. Reverting it would restore the exact split-brain architecture the blueprint correctly rejects.

However, the cleanup was performed before replacement domain endpoints existed. That created a live-mode gap: the UI now serves fixtures even in live mode and approval decisions are validated no-ops. The post-cleanup documentation then incorrectly marked Phase 0 complete and directed work to Phase 3, even though Phase 0's CI/staging/Sentry gate and all of Phases 1-2 remain incomplete.

The hurried demo-agent work is useful as a disposable interaction prototype, but it is not wired into the UI and must not be merged into the production worker architecture in its present form. Preserve it on a separate demo/WIP branch, then rebuild its useful graph shapes after the gateway, domain API, durable queue, and Postgres checkpointer exist.

Overall blueprint verdict: strategically sound, but not approved as written. Its core architecture is good. Its current-state claims, compliance wording, observability footprint, HTTP 402 choice, and sequencing/status need correction.

## 1. What changed after the cleanup

### 1.1 Branch position

- `anzar` and `origin/anzar` both point to `213bb6f4352defa47cefdef07263de2041526f3e`.
- `anzar` is exactly two commits ahead and zero behind `origin/main`.
- `origin/main` and `main` point to `451bcf6887273d653e51acaf549358d26ee702e8`, which is the cleanup commit's parent.
- The reflog shows no later hidden commits, rebases, resets, or force-moved local work.
- All pre-cleanup files remain recoverable from `451bcf6`; nothing requires a destructive history rewrite.

### 1.2 Commit timeline

| Commit | Date/author | Actual effect |
|---|---|---|
| `605c33a6a3e81ee9d15c44f16f50e6e3d544e50f` | 2026-08-11 15:45:56 IST, Anzar | Cleanup and monorepo consolidation. 265 files changed, 865 insertions, 7,089 deletions. |
| `213bb6f4352defa47cefdef07263de2041526f3e` | 2026-08-11 15:47:50 IST, Anzar | The only commit after cleanup. Documentation only: root README, consolidated `PENDING.md`, runbook edits, and deletion of retired plans/specs. No runtime code changed. |

### 1.3 What the cleanup did well

- Renamed `helm-api/` to `api/`; almost all JWT verification, issuer/subject identity, membership selection, RLS, audit, Alembic, and security tests moved unchanged.
- Renamed `helm-app/` to `web/`; most visual components and application surfaces moved unchanged.
- Established the intended `api/`, `web/`, `workers/`, `docs/` monorepo boundary.
- Removed the frontend-owned SQL migrations, email-keyed identity path, direct Neon access, duplicate scope vocabulary, and bypass-reader machinery.
- Removed the old TypeScript gateway placeholder instead of treating regex guardrails and post-call usage logging as a production model gateway.
- Kept server-side access-token custody and the typed FastAPI client/problem translation pattern.
- Added a clearer shell-data seam, canonical API-to-UI role mapping, and tests around those seams.

### 1.4 What the cleanup removed too early or accidentally

- It deleted Phase A before Phase 2 supplied replacement domain endpoints. The architectural deletion was correct; the cutover timing was not.
- It removed `helm-api/.env.example` without adding a tracked `api/.env.example`. Current setup documents instruct users to copy a file that a fresh clone does not contain.
- It removed useful domain behavior and adversarial tests along with the obsolete runtime. Campaign/approval schemas, approval race behavior, RLS cases, date conversions, and repository semantics should be selectively ported into FastAPI/Alembic, not restored under `web/`.
- It retired old plans from the active tree. That is reasonable, but any still-useful rationale should be restored only under an explicitly historical archive; Git already remains the authoritative archive.

### 1.5 The only committed work after cleanup

`213bb6f` changed documentation only. Its main useful outcome was one current status document. Its main problems are accuracy:

- `docs/PENDING.md:112` calls Phase 0 complete, while `docs/PENDING.md:198` admits there is no CI configuration.
- It says the next task is Phase 3 (`docs/PENDING.md:130`) while Phases 1 and 2 are unfinished.
- It claims zero-setup demo access, but the auth proxy still redirects protected pages to a login screen with no configured provider.
- It says Python 3.12 and that pytest runs, while `api/pyproject.toml:9` and `api/.python-version` require 3.13 and the local virtual environment points to a missing Python 3.12 installation.
- It instructs copying the absent `api/.env.example`.
- `docs/open-decisions.md` and `docs/backend-fastapi_llm-architecture.md` still contain pre-cleanup paths/state and contradict the claimed single source of truth.

## 2. Uncommitted demo work after the two commits

The current worktree contains a modified root `.gitignore` and untracked demo files under `web/demo-data/`, `web/lib/data/demo-fs.ts`, and `workers/`.

### Useful ideas worth preserving as a demo reference

- Explicit Analyst and Media Buyer graph shapes.
- Structured model output schema.
- Policy calculations performed in code rather than trusted from the model.
- A visible kill-switch concept.
- Offline fixtures for deterministic demonstrations.
- Atomic single-file replacement to reduce torn JSON reads.
- Narrated terminal flow that communicates the intended product well.

### Why it is not production or even currently end-to-end

- `web/lib/data/demo-fs.ts` has no importers. Worker proposals do not appear in the UI, UI approval decisions do not reach the watcher, worker campaign changes do not appear in the UI, and run/usage data is not rendered.
- `workers/demo_agents/gateway_stub.py` directly imports the Anthropic SDK and reads the provider key. This contradicts the committed worker boundary, which says all model calls pass through the FastAPI gateway and workers never hold provider keys.
- The graphs use a new `MemorySaver()` per CLI invocation, not a durable Postgres checkpointer. There is no real pause/resume from an approval checkpoint.
- JSON files provide no tenant isolation, RLS, transaction boundary, cross-process locking, durable queue, outbox, or reliable audit semantics.
- The Media Buyer writes campaign state before it marks a proposal executed. A crash between those writes can apply the same budget shift twice after restart; the code's idempotency claim is therefore false.
- The watcher records an ID in in-memory `executed_ids` before execution. A transient failure will not retry in that process.
- The kill switch is checked before a run or poll cycle, not at every high-impact action in an in-flight run.
- Usage is recorded after the provider call. There is no reserve-before cap transaction, no abandoned-reservation recovery, and a logging failure can leave a paid call unmetered.
- A Vercel web process and separately hosted workers cannot share this local filesystem.
- Worker dependencies use broad lower bounds, have no lock/project metadata, and have no project-owned tests.

Disposition: preserve on a separate `demo-wip` branch or in an untracked snapshot; do not merge these files into the production worker spine as-is. The extra root `.gitignore` lines are redundant because `.env*` already matches both entries; `workers/.gitignore` itself is useful.

## 3. Current verification evidence

| Check | Result on 2026-08-12 | Interpretation |
|---|---|---|
| Web Vitest | 207/207 passed, 43/43 files | Good local unit/component baseline. |
| TypeScript | `tsc --noEmit` passed | Good. |
| ESLint | Passed | Good. |
| Next production build | Passed after allowing the configured Google Font download | Build is green, but it has an external build-time dependency; self-hosting the font would make builds more reproducible. |
| API pytest | Could not start | `api/.venv` points to a removed Python 3.12 installation; this does not prove API tests fail, but the current checkout cannot substantiate the documented green claim. |
| DB/RLS integration suite | Not run in this audit | No valid Python runtime and no confirmed disposable Postgres/Docker gate. Phase 0 cannot claim fail-not-skip verification. |
| Worker tests | None | The uncommitted worker prototype is unverified. |
| CI configuration | None found | Blueprint Phase 0 gate is not met. |
| Staging deployment evidence | None found | Blueprint Phase 0 gate is not met. |
| Production dependency audit | Four high-severity findings | Includes Next 16.2.10 auth-proxy bypass and Server Action DoS; upgrade and retest before any deployment. |

The production build initially failed only because `next/font` could not reach Google Fonts from the sandbox. With network access, it completed and generated all 19 routes.

## 4. Critical current defects

### P0 - stop production deployment

1. **Live mode serves fabricated data.** `web/lib/data/index.ts:8-16` explicitly says every getter serves fixtures in both demo and live mode; lines 18-61 return fixture objects. This violates the blueprint's promise that production never touches fixtures.

2. **Approval is a no-op.** `web/app/(app)/approvals/actions.ts:25-35` validates the ID/decision and returns success without authentication in the action boundary, authorization, persistence, RLS, idempotency, or audit.

3. **The auth boundary currently depends on a vulnerable Next version.** `web/package.json` pins Next 16.2.10. Current advisories mark versions below 16.2.11 affected by an App Router proxy authentication bypass and a Server Action denial of service. Because HELM relies on `proxy.ts` for route protection and uses Server Actions, this is directly relevant. Upgrade deliberately to at least the patched release, update the lockfile, and rerun the full gate; do not use a blind force-fix.

4. **Auth0's default access token can be rejected.** `api/app/auth/jwt_verifier.py:16` requires `jti`. Auth0's default access-token profile does not include `jti`; its RFC 9068 profile does. The runbook creates an API with identifier and RS256 but does not select RFC 9068. Either configure and test the RFC 9068 profile explicitly or stop requiring an unused `jti` until replay detection is actually implemented.

5. **Direct Google/Microsoft login cannot produce a HELM API token.** `web/auth.ts:11-20` offers direct Google and Azure providers, and lines 117-123 forward those providers' upstream access tokens. FastAPI accepts one configured Auth0/HELM issuer and audience, so Google/Microsoft resource tokens cannot satisfy that contract. For now, route social/enterprise login through Auth0 connections so Auth0 mints the HELM API token, or remove the direct providers.

6. **Production readiness can report ready when dependencies are absent.** `api/app/api/v1/health.py:45-49` always returns `ready` with DB and queue marked not configured. `api/app/config.py` also permits production/staging startup without OIDC or a database, while protected routes then lack required app state. Production must fail at startup on incomplete required configuration and readiness must probe every load-bearing dependency.

7. **No BFF workload assertion or API rate limiting exists.** `ALLOW_DEV_UNASSERTION` is only configuration/test surface; direct bearer-token API calls remain accepted. The blueprint's Phase 1 security gate is unmet.

### P1 - blocks a trustworthy staging gate

8. **Live tenant discovery/switching is structurally broken.** Multi-membership users need a tenant hint before `/tenants` can resolve a caller, but `/tenants` is supposed to provide the list from which they choose. It then returns only the selected tenant. The web redirects the no-hint error to `/no-access`, so the switcher can never show multiple live memberships.

9. **The zero-setup demo claim is false.** `proxy.ts` protects application routes; `auth.ts` registers zero providers with an empty environment; the login page then says no sign-in method is configured. Demo mode changes data/shell behavior but not authentication.

10. **Demo mode is unsafe for production configuration.** `isDemoMode()` defaults to true whenever `HELM_API_BASE_URL` is absent, including a misconfigured production build. Production should hard-fail unless live mode is fully configured, or require an explicit, separately authorized demo deployment with a permanent banner and synthetic tenant data.

11. **No CI/staging/Sentry gate exists.** Structured JSON API logging does exist and is a good foundation, but Phase 0 explicitly requires CI, fail-not-skip integration tests, Sentry, and a working staging deployment.

12. **Residency cannot safely remain an optional Phase 7 question.** DPDP itself is not blanket localization, but the current SEBI Research Analyst SaaS advisory says covered critical data must remain in India. Applicability depends on Finnovate's exact registration/activity, yet the currently suggested R2/Neon/Railway regions do not provide an India guarantee. Before real PII or regulated workloads, obtain counsel/compliance sign-off on a data-flow/residency matrix and approved vendors.

13. **Setup is internally inconsistent.** Restore a trackable `api/.env.example`; add a `.gitignore` exception for templates; align README/PENDING/runbooks to Python 3.13; recreate both virtual environments.

14. **The local ignored root `.env` contains a provider credential.** It is not tracked in Git. Rotate it if it has ever been copied, uploaded, screen-shared, or used outside this machine; never place it in worker config or reports.

### P2 - required before paying tenants

- Close FastAPI `httpx.AsyncClient` and database engine resources through application lifespan handling.
- Make authorization checks live inside every data/action boundary, not only the proxy.
- Add CSP/security headers, dependency/SAST/container scanning, secret scanning, and controlled upload/output handling.
- Implement real readiness, metrics, tracing, alerting, backups, restore drills, retention/erasure jobs, and tenant offboarding.
- Reconcile all live architecture/status documents and clearly label historical documents.

## 5. Actual phase status versus the blueprint

| Phase | Actual status | Evidence-based verdict |
|---|---|---|
| 0. Foundation | Partial | Monorepo, secure API core, UI port, and structured API logs exist. CI, mandatory integration environment, Sentry, staging, reproducible setup, and a verified API suite do not. Phase 0 is not complete. |
| 1. Close auth gap | Incomplete | Tenant hint seam exists, but discovery is broken; no workload assertion or rate limiting; Auth0 token-profile mismatch is likely. |
| 2. Domain cutover | Incomplete and currently unsafe | Old Phase A is deleted, but campaigns/approvals/directory/integrations endpoints do not replace it. Live data remains fixtures; approvals are a no-op. The gate fails. |
| 3. Model gateway | Not started in committed production code | No contracts, provider adapters, transactional ledger, key boundary, tracing, or concurrency gate. The uncommitted worker stub is not this gateway. |
| 4. Studio generation | UI prototype only | No real generation-to-compliance-to-persistence-to-approval-to-billing slice or eval gate. |
| 5. Async spine + creative | Not started | No queue, leases, retries, outbox, DLQ, durable worker, R2 path, or signed URL flow. |
| 6. Agents + MCP | Disposable demo reference only | Uncommitted LangGraph shapes exist, but no durable checkpoint, interrupt/resume, API gateway, tenant RLS, MCP, or atomic execution. |
| 7. Scale and sovereignty | Correctly not started | This should remain trigger-driven. |

The correct next milestone is Phase 0 closure, followed by Phases 1 and 2. Gateway design can be developed in parallel if capacity allows, but the production branch must not claim or ship Phase 3 before the earlier gates are green.

## 6. Validation of the Claude blueprint

### Correct and worth keeping

- **Consolidate and extend, not rewrite.** The FastAPI identity, JWT, RLS, audit, and test culture are the strongest assets in the repository.
- **One authoritative product database and one migration owner.** Alembic plus a least-privileged runtime role is the right baseline.
- **Thin provider-neutral gateway inside the modular monolith first.** Extracting it later only when operational evidence demands it is sensible.
- **Reserve-before/reconcile-after budget accounting.** The concurrency test described in the blueprint is essential.
- **Direct SDKs for simple generation/chat; LangGraph only for durable stateful agents.** LangGraph is officially usable without LangChain and is intended for durable execution and human-in-the-loop workflows.
- **Postgres queue plus outbox before Redis.** PostgreSQL explicitly documents `SKIP LOCKED` as suitable for queue-like consumers, provided HELM also implements leases, retries, ordering/fairness policy, idempotency, monitoring, and a DLQ.
- **pgvector before a separate vector database.** Reasonable for the expected scale, with recall/load tests and tenant-scoped filtering.
- **Local inference only on a residency/economics/availability trigger.** vLLM exposes an OpenAI-compatible surface, and routing by logical task plus eval-gated promotion is a good future-proofing pattern.
- **Prompt versioning, eval suites, outbox, idempotency, observability, DR, and explicit human approval.** These are production requirements, not optional polish.

### Correct direction, but needs qualification

1. **"One database" must mean one product system-of-record database.** Current self-hosted Langfuse uses PostgreSQL plus ClickHouse, Redis/Valkey, and blob storage. It cannot simply "run on the project's own Postgres" while preserving the stated one-database footprint. Decide between a separate observability data plane, a managed regional service, or a lighter OpenTelemetry-first start.

2. **A model verdict cannot be the compliance gate.** Use versioned deterministic rules for hard prohibitions and required disclosures, an LLM classifier as decision support, evidence/citations, and a qualified human approval path. Measure false-negative rates. No model should silently authorize publication. The PDF is internally inconsistent: one passage disables shipping for violations, while another permits flagged variants after acknowledgement. Hard failures must be non-overridable; acknowledgement is suitable only for explicitly classified warnings.

3. **SEBI applicability is entity/activity specific.** The prohibition on assured or risk-free returns is real, but the current 2026 master circular for the client's exact registration/activity is the control source. "Financial client" alone does not prove that the IA/RA advertising code applies to every asset. For covered IAs/RAs, identity/registration details, warnings/disclosures, supervisory approval/retention, and AI-use responsibility/disclosure can extend beyond HELM's internal human click. Obtain compliance counsel sign-off on the rule corpus, approval path, and override policy.

4. **DPDP is not a blanket India-localization rule.** The Act permits government-notified transfer restrictions rather than imposing universal local hosting. Its provisions commenced on a staged schedule from November 2025; the substantive duties in sections 3-17 and matching final Rules are scheduled for 14 May 2027. Build the controls now, but describe them as May-2027 readiness rather than already-complete DPDP compliance. Residency may still be required now by a client contract or sectoral rule. There is no one generic erasure window: define the controller/processor roles, legal basis, data-class retention, rights SLA, deletion propagation, breach process, and the minimized non-PII audit skeleton that may remain.

5. **HTTP 402 is an application convention, not standardized budget semantics.** RFC 9110 reserves 402 for future use. HELM may use it if all clients and gateways are tested, but 403 or 409 with a stable RFC 9457 `budget_exceeded` problem code is less semantically speculative. Decide and document the contract.

6. **OpenAI-compatible local serving does not mean zero integration work.** Tool calling, structured output, token accounting, streaming, stop reasons, safety behavior, and model capability differ. Keep a real capability-aware adapter and run the same eval/contract suite before routing traffic.

7. **MCP is a transport/tool protocol, not a security boundary.** Tenant credential isolation, tool authorization, egress allow-lists, request signing, idempotency, audit, and proposal-only restrictions remain HELM responsibilities.

8. **Postgres `SKIP LOCKED` is a primitive, not a queue.** PostgreSQL warns that it provides an inconsistent view appropriate to queue-like access, not general reads. Define job state, lease expiry, heartbeat, retry/backoff, poison-message handling, fairness, and recovery.

9. **The budget ledger design needs failure accounting.** Add expiring reservations, reconciliation idempotency, provider timeouts with unknown outcome, actual-cost-over-estimate handling, refunds/cancellations, rate-card versioning, billing-period timezone, and an invariant tying audit and usage rows to one request/idempotency key.

10. **"Near-zero additional security work" is wrong.** The identity core is strong, but workload identity, rate limiting, dependency patching, production configuration, action-boundary authorization, secrets, egress controls, prompt-injection defenses, incident response, and compliance evidence remain substantial.

11. **LangGraph does not resume an interrupted node at the exact source-code line.** On resume, the interrupted node restarts from its beginning and code before `interrupt()` runs again. Put side effects after the interrupt or in separate idempotent nodes, and encrypt/minimize/tenant-authorize checkpoint state.

12. **"Absolute" RLS claims need an operational qualifier.** RLS is excellent defense in depth, but superusers and `BYPASSRLS` roles bypass it, owners bypass unless `FORCE ROW LEVEL SECURITY` is used, and unsafe policy/subquery design can race. Keep non-owner/no-bypass runtime and worker roles, FORCE RLS on every tenant table, explicit tenant filters, fail-closed context, and adversarial role/migration tests.

### Incorrect current-state claims

- Phase 0 is complete.
- Production never touches fixtures.
- The zero-setup demo currently renders every surface.
- Authentication is essentially done.
- Self-hosted Langfuse runs only on the project's existing Postgres.
- The current demo agents demonstrate durable HITL/idempotent execution.

### Current model/API facts

The blueprint's Claude Opus 5 and Sonnet 5 names are current as of this audit, and the uncommitted stub's `claude-opus-5` ID and listed $5/$25 per-million-token rates match the current official model table. Anthropic also documents `output_config.format` for schema-constrained JSON, matching the stub's API shape. Keep model IDs and rates in versioned routing/rate-card configuration and revalidate them at build/release time instead of embedding them in long-lived architecture prose.

## 7. Keep, rework, and drop decision

### Keep

- Commits `605c33a` and `213bb6f` as history; correct them with new commits rather than reverting shared history.
- `api/`, `web/`, `workers/`, `docs/` monorepo layout.
- FastAPI issuer/subject identity, membership and scope arithmetic, forced RLS, non-bypass runtime role, keyhole functions, JWKS rotation handling, RFC 9457 errors, allow-listed audit metadata, Alembic ownership, and fail-not-skip philosophy.
- Frontend presentation components, shell, API client/error seam, server-side token custody, route matcher, and exhaustive role mapping.
- Explicit demo-mode concept and offline demonstration fixtures, isolated from production.

### Rework or selectively recover

- Port pre-cleanup campaign/approval schemas and behavioral tests from `451bcf6` into FastAPI/Alembic.
- Restore `api/.env.example` as a template, not the old runtime.
- Repair demo authentication and add a permanent demo banner/synthetic tenant, or stop claiming zero setup.
- Rebuild demo graph ideas after Phase 5/6 foundations.
- Reconcile current documentation; archive selected old rationale only if still useful.

Useful historical sources include:

- `451bcf6:helm-app/db/migrations/0002_model_gateway.sql`
- `451bcf6:helm-app/db/migrations/0003_operate_core.sql`
- `451bcf6:helm-app/lib/repositories/campaigns.ts`
- `451bcf6:helm-app/lib/repositories/approvals.ts`
- the deleted RLS, approval race, date conversion, and repository tests

### Drop from the production path

- Unconditional live fixtures and no-op success responses.
- Mutable JSON files as authoritative app/agent/audit state.
- `workers/demo_agents/gateway_stub.py` as a production gateway.
- JSON-based budget execution and in-memory checkpoint/idempotency claims.
- Redundant root `.gitignore` additions.
- Any attempt to restore the old Next.js database/migration/auth spine, bypass reader, or placeholder TypeScript gateway.

## 8. Corrected resume plan

### Recovery checkpoint - preserve before changing

1. Snapshot all uncommitted demo files on a separate `demo-wip` branch or with a named stash that includes untracked files.
2. Tag or record `213bb6f` as the post-cleanup baseline.
3. Continue production work with additive corrective commits. Do not rewrite or broadly revert `anzar`.

### Phase 0A - make the repository truthful and reproducible

- Upgrade Next to a patched release and rerun test/type/lint/build/audit.
- Align Python at 3.13, recreate virtual environments, and run unit plus real DB/RLS integration tests with zero skips.
- Restore and track `api/.env.example`; fix all setup instructions.
- Make staging/production hard-fail on missing DB, OIDC, workload identity, secrets, or accidental demo mode.
- Fix readiness/lifespan resource management.
- Configure the intended Auth0 token profile and add a real end-to-end token fixture/test.
- Add CI for web, API, mandatory Postgres integration, migration rehearsal, dependency/secret scanning, and artifact build.
- Deploy a production-shaped staging environment and run `preflight --live` plus smoke tests.
- Add Sentry/error tracking and retain the existing structured API logging.
- Gate: all Phase 0 requirements in the PDF are evidenced, not merely checked in a status table.

### Phase 1 - close the auth and tenancy boundary

- Implement a short-lived, rotated BFF workload identity; require it with the user token, or make the API private and still authenticate service-to-service calls.
- Put authorization in every server action/data boundary.
- Add per-user, per-tenant, and service rate limits.
- Split tenant discovery from tenant-scoped operations so a caller can list all active memberships without already choosing one.
- Validate the active-tenant hint and make the live switcher work for multi-membership users.
- Gate: direct calls lacking workload identity fail in staging; multi-tenant discovery/switching passes end-to-end.

### Phase 2 - restore real domain behavior through the correct boundary

- Port campaigns, approvals, directory, and integrations schema/semantics into Alembic/FastAPI.
- Port the valuable deleted behavioral and adversarial tests.
- Make web getters call only the typed BFF/API path in live mode; production must fail closed or show "not implemented", never fixtures.
- Make approvals transactional, scoped, idempotent, audited, and concurrency-tested.
- Gate: no live fixture reads, one schema/migration owner/scope vocabulary, and every domain mutation is RLS- and audit-proven.

### Phase 3 - build the real gateway

- Provider-neutral contracts and capability declarations.
- Provider adapters with explicit timeouts, retry classification, circuit breaker, and no silent fallback.
- Transactional budget reservation/reconciliation with expiry/recovery and the N-vs-cap concurrency test.
- Versioned routing and rate-card tables.
- Provider keys only in the gateway secret boundary.
- Trace/audit correlation; choose an observability deployment whose real infrastructure and region are documented.
- Decide 402 versus a conventional status plus `budget_exceeded` problem code.

### Phase 4 - first production AI value

- Studio brief to variants to deterministic/LLM compliance evidence to human decision to persistence/audit/billing.
- Versioned prompts and rule corpus.
- Golden evals with measured compliance false-negative thresholds and human review.
- No public shipping connector until the compliance owner signs off the rule set and override policy.

### Phase 5 - durable async spine

- Postgres job model with leases/heartbeat/retry/backoff, outbox, idempotent consumers, DLQ, and re-drive.
- R2 lifecycle, tenant-prefixed keys, signed URLs, manifest/orphan detection.
- Worker restart and side-effect crash tests.

### Phase 6 - agents and integrations

- Reimplement the useful Analyst/Media Buyer graph ideas against real tenant-scoped API tools.
- Postgres checkpointer and explicit LangGraph interrupt/resume.
- Read-only Analyst first; all write tools proposal-only until policy thresholds are approved.
- Kill switch enforced at dispatch and immediately before each high-impact tool call.
- MCP connectors treated as untrusted integration boundaries with credential brokerage and egress controls.

### Phase 7 - only on measured triggers

- Evaluate hosted fine-tunes/local models against the same versioned suite.
- Introduce vLLM/Redis only when residency, economics, availability, or load evidence crosses a signed threshold.
- Demonstrate config-only rollback before routing real traffic.

## 9. Decisions that need owner sign-off now

1. Production hosting and private-network topology for web, API, workers, Postgres, and object storage.
2. Auth0 as the final IdP and the exact access-token profile.
3. Explicit demo deployment policy: local only, or separately hosted with synthetic data and a permanent banner.
4. Postgres queue as the initial queue, including measurable Redis graduation thresholds.
5. Observability choice and real data-plane footprint/region; do not assume self-hosted Langfuse is free or Postgres-only.
6. Per-tenant budget and versioned internal rate-card policy.
7. Client-specific regulatory scope, data residency basis, retention schedule, compliance owner, and override rules.
8. Whether `budget_exceeded` uses reserved HTTP 402 or a conventional status with a stable RFC 9457 code.

## 10. Primary references used to validate the plan

- [Anthropic current model IDs and pricing](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Auth0 access token profiles](https://auth0.com/docs/secure/tokens/access-tokens/access-token-profiles)
- [LangGraph overview: standalone use, persistence, HITL](https://docs.langchain.com/oss/python/langgraph/overview)
- [Langfuse self-hosted ClickHouse/infrastructure documentation](https://langfuse.com/self-hosting/deployment/infrastructure/clickhouse)
- [PostgreSQL `SKIP LOCKED` semantics](https://www.postgresql.org/docs/current/sql-select.html)
- [pgvector HNSW/filtering behavior](https://github.com/pgvector/pgvector)
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)
- [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP 402 is reserved](https://www.rfc-editor.org/rfc/rfc9110.html#name-402-payment-required)
- [Official DPDP Act 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf)
- [Official 2025 DPDP commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)
- [Official final DPDP Rules 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- [SEBI 2026 master circular listing](https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6)
- [SEBI 2026 Research Analyst master circular](https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770375507051.pdf)
- [SEBI advertisement code source](https://www.sebi.gov.in/legal/circulars/apr-2023/advertisement-code-for-investment-advisers-ia-and-research-analysts-ra-_69798.html)
- [Next.js proxy-bypass advisory and patched version](https://github.com/advisories/GHSA-6gpp-xcg3-4w24)
- [Next.js Server Action DoS advisory and patched version](https://github.com/advisories/GHSA-m99w-x7hq-7vfj)

## Final recommendation

Keep the cleanup architecture. Quarantine the hurried demo implementation. Repair Phase 0 truthfully, complete the auth/tenant boundary, then restore domain behavior through FastAPI before building the gateway and AI vertical slice. This preserves the hard-won security work while avoiding months of production debt disguised as demo velocity.

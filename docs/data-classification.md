# HELM Data Classification, Storage, and Retention (Stage 0)

## Classification

| Class | Examples | Storage and controls |
|---|---|---|
| Public/internal operational | Aggregated campaign metrics, platform health, model routing configuration | Neon; tenant scoping where applicable; RBAC and audit for administrative changes |
| Confidential business | Campaign plans, budgets, performance, creative briefs, approval payloads, agent state | Neon/R2 by form; tenant RLS; encryption in transit/at rest; least privilege; audited access |
| Personal data / sensitive personal data | Contact email/phone, identity attributes, lead profile, consent, WhatsApp/email content, uploaded documents | Minimize; Neon encrypted fields/tokenized identifiers; R2 only when needed; purpose/consent tags; access logging; deletion workflow |
| Restricted secrets | OAuth refresh tokens, API keys, provider credentials, encryption keys, signing keys | Dedicated vault/KMS references only; never Neon plaintext, R2, queues, logs, browser, model prompts, or audit metadata |
| Regulated/compliance evidence | Consent proof, suppression/opt-out, approval decisions, outbound content/version, policy verdicts, audit events | Neon append-only/evidence model; immutable retention controls; legally approved export and deletion exceptions |

## System of record by store

**Neon/Postgres:** tenants, global users, memberships, roles/scopes, normalized campaigns/leads/conversions, consent and suppression state, integrations metadata and vault references, model policy/budgets/usage, approvals, agent runs/checkpoints metadata, audit/outbox/inbox/deduplication records. Tenant-owned data requires `tenant_id`, RLS, and a server-set transaction context. Use row-level encryption/envelope encryption for raw PII where hashing alone cannot serve the purpose.

**R2:** creative binaries, uploads, generated media, exports, and attachment payloads. HELM uses Cloudflare R2 with an APAC location hint, but this does not guarantee Singapore-specific data residency; compliance must confirm whether this is acceptable. Use opaque tenant-prefixed object keys, encryption, malware/content scanning before availability, object metadata limited to non-sensitive routing data, and FastAPI-issued short-lived signed URLs. Maintain authoritative asset metadata, retention status, and access authorization in Neon.

**pgvector:** tenant-scoped embeddings and source references for approved documents, campaign knowledge, and workspace retrieval. Embeddings can retain sensitive semantics; classify them at least as the source class, store tenant id and source/version/deletion linkage, apply RLS/filtering, and delete/re-embed on source deletion or consent withdrawal. Do not embed secrets or data not authorized for model processing.

**Queue/workers:** minimal job ids, tenant id, object references, idempotency keys, correlation ids, and immutable command parameters necessary to execute. Do not place raw credentials or large PII payloads in messages. Encrypt managed queue transport/storage, use short TTLs, dead-letter access controls, and reconstruct sensitive context from Neon/vault at execution time.

**Tenant integration credentials (current decision):** a client may enter an API key through the frontend only when it is transmitted over HTTPS directly to FastAPI. FastAPI immediately encrypts it before Neon persistence using AES-256-GCM, a unique nonce per encryption operation, tenant ID plus integration ID as associated data, and encryption-key version metadata. The current encryption key is held in Railway/Vercel encrypted environment secrets. Browser state, the BFF, queues, audit records, application logs, and BFF logs must never retain or emit the raw secret. Neon stores ciphertext, nonce, key version, provider/integration metadata, scopes, rotation/expiry metadata, and health state; it does not store plaintext credentials.

For OAuth integrations, use authorization-code redirect/callback flows and store the resulting credentials under the same protected backend control. Do not ask clients to paste access tokens or refresh tokens. A dedicated vault/KMS remains deferred and is not implemented; it is the intended future replacement for environment-secret-held encryption material.

## DPDP and SEBI controls

Capture purpose, lawful basis/consent, collection source, and consent version for personal data. Suppression/opt-out must be checked by the policy layer before every outbound action and must propagate to integrations promptly. Support data-subject access/correction/deletion workflows with identity verification, tenant isolation, and retention/legal-hold exceptions. Keep raw PII out of prompts unless a documented tenant purpose/policy permits it; redaction is defense-in-depth, not the primary consent mechanism.

For financial-adjacent content, preserve the approved creative/copy version, compliance verdict/ruleset version, reviewer/decision, delivery target, and timestamp. Model output is untrusted until policy/compliance processing succeeds. Audit records are append-only; corrections are new linked events.

## Encryption, logging, and retention

Use TLS in transit; provider-managed encryption at rest plus application envelope encryption for designated PII/credentials; KMS-managed rotation; and separate keys by environment. Logs, traces, analytics, and error reports must redact tokens, credentials, raw PII, and prompt/output bodies by default. Audit metadata uses allow-listed structured fields and content hashes/references, not secret or PII dumps.

Retention periods, backup expiry, regional residency, deletion SLA, and legal-hold policy are **open product/legal decisions**. Until approved, collect the minimum necessary, apply short retention to queue payloads and transient model traces, and prohibit production ingestion of unrestricted contact databases.

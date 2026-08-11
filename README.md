# HELM

Multi-tenant, AI-native marketing operations platform: campaign analytics,
AI-generated creative production, an embedded AI workspace, supervised
marketing agents, and a compliance-first approvals pipeline — one web app,
one sealed room per client.

## Layout

| Directory | What it is |
|---|---|
| `api/` | FastAPI control plane — OIDC/JWT verification, identity keyed on `(issuer, subject)`, tenant memberships, Postgres row-level security, append-only audit. Owns the schema via Alembic. The model gateway (Phase 3) lands here. |
| `web/` | Next.js app — the UI **and** the BFF in one deployment. NextAuth + Auth0; the access token lives in an encrypted httpOnly cookie and never reaches the browser. Talks only to `api/`. |
| `workers/` | Empty scaffold for the async spine: queue consumers, generation jobs, LangGraph agents (Phases 5–6). See its README. |
| `docs/` | The contracts (auth, BFF, versioning, roles/scopes, data classification, migration ownership) and **`docs/PENDING.md` — the single live status document**. |

`HELM_ARCHITECTURE.md` is the authoritative long-form specification;
`helm-mockup-v4.html` is the pixel source of truth for the UI design language.

## Run it

```bash
# web (renders every surface from fixtures in demo mode — zero setup)
cd web && npm install && npm run dev

# api
cd api && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app.main:app --reload

# verify the Auth0/API/DB wiring across both services
cd api && .venv/Scripts/python -m app.cli.preflight [--live]
```

Tests: `cd web && npm test` · `cd api && pytest` (DB-backed tests need Docker;
see `api/scripts/run_integration_tests.py`, which fails rather than skips).

## Where things stand

See `docs/PENDING.md` for verified current state, the phased build plan with
gates, and the open decision register.

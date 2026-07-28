# HELM API

HELM's authoritative FastAPI control-plane foundation. Stages 1–2 provide typed configuration, safe HTTP conventions, structured logging, operational endpoints, and the Neon/Postgres tenant, membership, RLS, audit, and Alembic migration foundation. Authentication, domain APIs, queues, workers, integrations, agents, R2, and model providers are not implemented yet.

## Local setup (non-Docker)

This project requires Python 3.12.x.

```powershell
cd helm-api
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Copy `.env.example` to `.env` only when local overrides are needed. Never commit `.env` or secrets.

## Commands

```powershell
pytest
ruff check .
mypy app tests
```

Operational endpoints are available at `/api/v1/health`, `/api/v1/ready`, and `/api/v1/version`. The readiness endpoint explicitly reports database and queue checks as future-stage work.

## Database migrations

Alembic is the canonical migration mechanism for `helm-api`. It uses `DATABASE_MIGRATION_URL`, the unpooled/privileged migration URL, never the application's pooled `DATABASE_URL`. Do not run these commands against a shared or production database without an approved migration plan.

```powershell
# Set only in your uncommitted local environment, then run from helm-api.
$env:DATABASE_MIGRATION_URL = "postgresql+asyncpg://..."
alembic current
alembic upgrade head
```

Create future revisions only after reviewing the generated migration and ownership plan:

```powershell
alembic revision -m "describe change"
```

The old `helm-app/db/migrations/` scripts are prototype-owned and must not target the same schema without an explicit, approved one-time migration plan. See `docs/database-migration-ownership.md`.

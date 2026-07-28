# HELM API

HELM's authoritative FastAPI control-plane foundation. Stage 1 intentionally provides only configuration, safe HTTP conventions, structured logging, and operational endpoints. It does not yet include databases, authentication, tenants, domain APIs, queues, workers, integrations, agents, or model providers.

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



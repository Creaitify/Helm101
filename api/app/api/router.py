"""Top-level API routing."""

from fastapi import APIRouter

from app.api.v1.agents import router as agents_router
from app.api.v1.health import router as health_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.workspace import router as workspace_router
from app.api.v1.workspace_threads import router as workspace_threads_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health_router)
api_router.include_router(tenants_router)
api_router.include_router(workspace_router)
api_router.include_router(workspace_threads_router)
api_router.include_router(agents_router)

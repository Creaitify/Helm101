"""The Stage 1 proving endpoint: the caller's own tenant memberships."""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_session_factory, require_scope
from app.auth.errors import NoMembershipError
from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import Scope
from app.db.models.audit import AuditActorType
from app.db.models.tenant import Tenant, TenantStatus
from app.db.repositories.audit import AuditEvent, AuditRepository
from app.db.tenant_context import TenantContext, tenant_scoped_transaction

router = APIRouter(tags=["tenants"])

require_tenant_read = require_scope(Scope.TENANT_READ)


class TenantSummary(BaseModel):
    """A tenant the caller may act in, read from the database record itself."""

    model_config = ConfigDict(extra="forbid")

    id: str
    slug: str
    name: str


class ContextMeta(BaseModel):
    """Non-authoritative presentation context for UI gating only.

    The BFF must not treat this as an authorization decision; every request is
    re-evaluated server-side.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: str
    tenant_slug: str
    role: str
    scopes: list[str]


class TenantListResponse(BaseModel):
    """The caller's tenant memberships plus non-authoritative context metadata."""

    model_config = ConfigDict(extra="forbid")

    data: list[TenantSummary]
    meta: ContextMeta


async def _load_active_tenant(session: AsyncSession, tenant_id: UUID) -> Tenant:
    """Load the caller's active tenant row, failing closed if it is missing.

    This should be unreachable in practice: membership resolution already
    joined to an active tenant before the caller was built. It fails closed
    with the same error as "no membership" rather than fabricate a response,
    consistent with the non-enumerability guarantee.
    """

    statement = select(Tenant).where(Tenant.id == tenant_id, Tenant.status == TenantStatus.ACTIVE)
    result = await session.execute(statement)
    tenant = result.scalar_one_or_none()
    if tenant is None:
        raise NoMembershipError
    return tenant


@router.get("/tenants", response_model=TenantListResponse, summary="List the caller's tenants")
async def list_tenants(
    request: Request,
    caller: AuthenticatedCaller = Depends(require_tenant_read),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> TenantListResponse:
    """Return the caller's tenant, read from the database and audited atomically."""

    context = TenantContext(tenant_id=caller.tenant_id, user_id=caller.user_id)
    request_id = getattr(request.state, "request_id", None) or str(uuid4())

    async with tenant_scoped_transaction(session_factory, context) as session:
        tenant = await _load_active_tenant(session, caller.tenant_id)
        await AuditRepository().append(
            session,
            context,
            AuditEvent(
                actor_type=AuditActorType.USER,
                actor_id=f"{caller.issuer}#{caller.subject}",
                action="tenant.context.read",
                target=f"tenant:{caller.tenant_id}",
                request_id=request_id,
                metadata={"source": "api", "outcome": "success"},
            ),
        )

    return TenantListResponse(
        data=[TenantSummary(id=str(tenant.id), slug=tenant.slug, name=tenant.name)],
        meta=ContextMeta(
            tenant_id=str(caller.tenant_id),
            tenant_slug=caller.tenant_slug,
            role=caller.role.value,
            scopes=sorted(scope.value for scope in caller.scopes),
        ),
    )

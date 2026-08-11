"""Tenant-scoped transaction helpers used by controlled repositories."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

TENANT_CONTEXT_SQL = text("select set_config('app.tenant_id', :tenant_id, true)")


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Internal, authenticated tenant context; Stage 3 will construct it from identity."""

    tenant_id: UUID
    user_id: UUID | None = None


async def establish_tenant_context(session: AsyncSession, context: TenantContext) -> None:
    """Set the Postgres RLS context for the current transaction only."""

    await session.execute(TENANT_CONTEXT_SQL, {"tenant_id": str(context.tenant_id)})


@asynccontextmanager
async def tenant_scoped_transaction(
    session_factory: async_sessionmaker[AsyncSession], context: TenantContext
) -> AsyncIterator[AsyncSession]:
    """Yield one committed/rolled-back transaction with RLS context established first."""

    async with session_factory() as session:
        async with session.begin():
            await establish_tenant_context(session, context)
            yield session

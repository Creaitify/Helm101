"""Async session factory creation using the pooled application database URL."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings


def create_database_engine(settings: Settings) -> AsyncEngine:
    """Create the application engine only after requiring DATABASE_URL."""

    return create_async_engine(settings.require_database_url(), pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Create sessions with explicit transactions managed by callers."""

    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)

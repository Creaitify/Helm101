"""FastAPI dependencies composing verification, identity, membership and scope."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.errors import InsufficientScopeError, InvalidTokenError
from app.auth.identity import resolve_identity
from app.auth.jwt_verifier import JwtVerifier
from app.auth.membership import AuthenticatedCaller, build_caller, select_membership
from app.auth.scopes import Scope
from app.config import Settings
from app.db.repositories.identity import IdentityRepository

TENANT_HINT_HEADER = "X-HELM-Active-Tenant"


def get_settings(request: Request) -> Settings:
    """Return the settings bound to the running application."""

    settings: Settings = request.app.state.settings
    return settings


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    """Return the application session factory created at startup."""

    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    return factory


def get_verifier(request: Request) -> JwtVerifier:
    """Return the process-wide verifier so its JWKS cache is shared."""

    verifier: JwtVerifier = request.app.state.jwt_verifier
    return verifier


def bearer_token(request: Request) -> str:
    """Extract a bearer token, refusing anything malformed."""

    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        raise InvalidTokenError
    return value.strip()


async def current_caller(
    request: Request,
    token: str = Depends(bearer_token),
    verifier: JwtVerifier = Depends(get_verifier),
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> AuthenticatedCaller:
    """Verify the token and resolve the caller's tenant membership and scopes.

    The tenant header is only a selection hint. It is matched against the
    caller's own memberships, so it can never widen access.
    """

    verified = await verifier.verify(token)
    repository = IdentityRepository()
    async with session_factory() as session:
        identity = await resolve_identity(session, repository, verified)
        memberships = await repository.list_active_memberships(session, identity.user_id)
    membership = select_membership(memberships, request.headers.get(TENANT_HINT_HEADER))
    return build_caller(identity.user_id, identity.issuer, identity.subject, membership)


def require_scope(scope: Scope) -> Callable[[AuthenticatedCaller], Awaitable[AuthenticatedCaller]]:
    """Build a dependency that admits only callers holding the given scope."""

    async def guard(caller: AuthenticatedCaller = Depends(current_caller)) -> AuthenticatedCaller:
        if not caller.has(scope):
            raise InsufficientScopeError
        return caller

    return guard

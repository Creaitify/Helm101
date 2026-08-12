"""FastAPI dependencies composing verification, identity, membership and scope."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.errors import InsufficientScopeError, InvalidTokenError
from app.auth.identity import resolve_identity
from app.auth.jwt_verifier import JwtVerifier
from app.auth.membership import AuthenticatedCaller, build_caller, select_membership
from app.auth.principal import Principal
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
        memberships = await repository.list_active_memberships(session, identity.issuer, identity.subject)
    membership = select_membership(memberships, request.headers.get(TENANT_HINT_HEADER))
    return build_caller(identity.user_id, identity.issuer, identity.subject, membership)


async def current_principal(request: Request) -> Principal:
    """Resolve the acting principal, by the real chain wherever possible.

    When a database and an OIDC issuer are configured, this is exactly
    `current_caller` — the token is verified, the identity resolved, the
    membership selected, the scopes computed. Nothing is skipped.

    Only when neither is configured *and* `ALLOW_LOCAL_PRINCIPAL` is set does it
    fall back to a fixed read-only local principal, so the Analyst is usable
    before Postgres exists. That flag is refused in staging and production at
    startup, so this branch cannot be reached there.
    """

    settings: Settings = request.app.state.settings
    has_backing_services = (
        getattr(request.app.state, "session_factory", None) is not None
        and getattr(request.app.state, "jwt_verifier", None) is not None
    )

    if has_backing_services:
        token = bearer_token(request)
        caller = await current_caller(
            request,
            token=token,
            verifier=get_verifier(request),
            session_factory=get_session_factory(request),
        )
        return Principal.from_caller(caller)

    if settings.allow_local_principal:
        return Principal.local(settings.local_principal_tenant_slug)

    # Neither a real chain nor an explicitly enabled local principal. Refusing
    # is the only honest answer: serving the request would mean acting for a
    # caller nobody identified.
    raise InvalidTokenError


def require_scope(scope: Scope) -> Callable[[AuthenticatedCaller], Awaitable[AuthenticatedCaller]]:
    """Build a dependency that admits only callers holding the given scope."""

    async def guard(caller: AuthenticatedCaller = Depends(current_caller)) -> AuthenticatedCaller:
        if not caller.has(scope):
            raise InsufficientScopeError
        return caller

    return guard

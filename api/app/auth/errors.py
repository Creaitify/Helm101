"""Auth failures expressed as safe, non-enumerable problem responses."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.errors import problem_response


class AuthError(Exception):
    """Base class for every authentication or authorization failure.

    Detail strings are deliberately generic. They never echo a token, a tenant
    id, or whether a resource exists, so responses cannot be used to enumerate
    tenants or probe membership.
    """

    status_code: int = 401
    code: str = "invalid_token"
    title: str = "Unauthorized"
    detail: str = "Authentication failed."


class InvalidTokenError(AuthError):
    """The bearer token was missing, malformed, expired, or failed verification."""

    status_code = 401
    code = "invalid_token"
    title = "Unauthorized"
    detail = "The access token is missing or not valid."


class InsufficientScopeError(AuthError):
    """A verified caller lacked the scope an endpoint requires."""

    status_code = 403
    code = "insufficient_scope"
    title = "Forbidden"
    detail = "The caller does not have the required scope."


class NoMembershipError(AuthError):
    """A verified caller has no active membership in the requested tenant.

    This is intentionally identical for a tenant that does not exist and a
    tenant the caller may not access.
    """

    status_code = 403
    code = "no_membership"
    title = "Forbidden"
    detail = "The caller does not have access to the requested tenant."


class TenantContextRequiredError(AuthError):
    """No tenant was selected and the endpoint defines no safe default."""

    status_code = 400
    code = "tenant_context_required"
    title = "Bad Request"
    detail = "A tenant selection is required for this request."


async def auth_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render an AuthError without leaking internals to the caller."""

    if not isinstance(exc, AuthError):
        raise exc
    return problem_response(
        request,
        status_code=exc.status_code,
        title=exc.title,
        code=exc.code,
        detail=exc.detail,
    )

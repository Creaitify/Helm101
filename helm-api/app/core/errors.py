"""Consistent RFC 9457-style problem responses."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException


class ProblemDetail(BaseModel):
    """Safe problem-details payload returned by the API."""

    model_config = ConfigDict(extra="forbid")

    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    code: str
    request_id: str


def problem_response(
    request: Request,
    *,
    status_code: int,
    title: str,
    code: str,
    detail: str | None = None,
    problem_type: str | None = None,
) -> JSONResponse:
    """Create a problem response without exposing internals or request data."""

    request_id = getattr(request.state, "request_id", "unknown")
    payload = ProblemDetail(
        type=problem_type or f"https://api.helm.local/problems/{code}",
        title=title,
        status=status_code,
        detail=detail,
        instance=str(request.url.path),
        code=code,
        request_id=request_id,
    )
    return JSONResponse(
        status_code=status_code,
        content=payload.model_dump(exclude_none=True),
        media_type="application/problem+json",
        headers={"X-Request-Id": request_id},
    )


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Normalize framework HTTP errors into a safe public contract."""

    if not isinstance(exc, StarletteHTTPException):
        return await unhandled_exception_handler(request, exc)

    titles: dict[int, str] = {401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed"}
    return problem_response(
        request,
        status_code=exc.status_code,
        title=titles.get(exc.status_code, "Request Error"),
        code="resource_not_found" if exc.status_code == 404 else "http_error",
        detail="The requested resource was not found." if exc.status_code == 404 else None,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never expose exception messages, tokens, or configuration to callers."""

    return problem_response(
        request,
        status_code=500,
        title="Internal Server Error",
        code="internal_error",
        detail="An unexpected error occurred.",
    )

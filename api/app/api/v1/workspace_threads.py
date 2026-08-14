"""Workspace thread management and persistent chat endpoints.

Tenant-isolated and scoped in code. All operations require authenticated principal.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import current_principal
from app.auth.principal import Principal
from app.db.repositories.workspace import WorkspaceRepository
from app.gateway.contracts import Message, Role
from app.gateway.errors import GatewayError
from app.knowledge.analyst import AnalystService

router = APIRouter(prefix="/workspace/threads", tags=["workspace-threads"])

_repo = WorkspaceRepository()


class CreateThreadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    tag: str | None = Field(default=None, max_length=100)


class UpdateThreadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_pinned: bool | None = None


class PostMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=4_000)
    model: str = Field(default="Claude", max_length=50)


class ThreadSummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    tenant_id: str
    user_id: str
    title: str
    tag: str | None = None
    is_pinned: bool
    created_at: str
    updated_at: str


class ThreadDetailOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    tenant_id: str
    user_id: str
    title: str
    tag: str | None = None
    is_pinned: bool
    created_at: str
    updated_at: str
    messages: list[dict[str, Any]]


def get_analyst(request: Request) -> AnalystService:
    analyst: AnalystService = request.app.state.analyst
    return analyst


@router.get("", response_model=list[ThreadSummaryOut], summary="List all active threads")
async def list_threads(
    tag: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    principal: Principal = Depends(current_principal),
) -> list[ThreadSummaryOut]:
    tenant_id = str(principal.tenant_id)
    user_id = str(principal.user_id) if principal.user_id else "anonymous"
    threads = _repo.list_threads(tenant_id=tenant_id, user_id=user_id, search_query=q, tag=tag, limit=limit)
    return [ThreadSummaryOut(**t) for t in threads]


@router.post("", response_model=ThreadDetailOut, status_code=201, summary="Create a new thread")
async def create_thread(
    body: CreateThreadIn,
    principal: Principal = Depends(current_principal),
) -> ThreadDetailOut:
    tenant_id = str(principal.tenant_id)
    user_id = str(principal.user_id) if principal.user_id else "anonymous"
    thread = _repo.create_thread(tenant_id=tenant_id, user_id=user_id, title=body.title, tag=body.tag)
    return ThreadDetailOut(**thread)


@router.get("/{thread_id}", response_model=ThreadDetailOut, summary="Get thread detail with message history")
async def get_thread(
    thread_id: str,
    principal: Principal = Depends(current_principal),
) -> ThreadDetailOut:
    tenant_id = str(principal.tenant_id)
    thread = _repo.get_thread(tenant_id=tenant_id, thread_id=thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return ThreadDetailOut(**thread)


@router.patch("/{thread_id}", response_model=ThreadDetailOut, summary="Update thread title or pin status")
async def update_thread(
    thread_id: str,
    body: UpdateThreadIn,
    principal: Principal = Depends(current_principal),
) -> ThreadDetailOut:
    tenant_id = str(principal.tenant_id)
    user_id = str(principal.user_id) if principal.user_id else "anonymous"
    thread = _repo.update_thread(
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=thread_id,
        title=body.title,
        is_pinned=body.is_pinned,
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return ThreadDetailOut(**thread)


@router.delete("/{thread_id}", status_code=204, summary="Soft delete thread")
async def delete_thread(
    thread_id: str,
    principal: Principal = Depends(current_principal),
) -> None:
    tenant_id = str(principal.tenant_id)
    user_id = str(principal.user_id) if principal.user_id else "anonymous"
    ok = _repo.soft_delete_thread(tenant_id=tenant_id, user_id=user_id, thread_id=thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Thread not found")


@router.post("/{thread_id}/messages", summary="Post user message and receive grounded analyst reply")
async def post_message_to_thread(
    thread_id: str,
    body: PostMessageIn,
    request: Request,
    principal: Principal = Depends(current_principal),
    analyst: AnalystService = Depends(get_analyst),
) -> dict[str, Any]:
    tenant_id = str(principal.tenant_id)
    thread = _repo.get_thread(tenant_id=tenant_id, thread_id=thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    # 1. Append user message
    user_msg = _repo.append_message(
        tenant_id=tenant_id,
        thread_id=thread_id,
        role="user",
        content=body.content,
        model=body.model,
    )

    # 2. Bounded Context Window Assembly:
    # Keep last 8 turns verbatim; summarize older turns if any to protect token budget
    existing_messages = thread.get("messages", [])
    history_turns: list[Message] = []
    
    # Take up to last 8 prior turns
    recent_msgs = existing_messages[-8:]
    for m in recent_msgs:
        role = Role.USER if m["role"] == "user" else Role.ASSISTANT
        history_turns.append(Message(role=role, content=m["content"][:4000]))

    request_id = getattr(request.state, "request_id", None) or str(uuid4())
    idempotency_key = request.headers.get("Idempotency-Key")

    # 3. Ask Analyst
    try:
        result = await analyst.ask(
            body.content,
            tenant_id=principal.tenant_id,
            request_id=request_id,
            idempotency_key=idempotency_key,
            history=history_turns,
        )
    except GatewayError:
        raise

    citations_list = [
        {
            "label": c.label,
            "source": c.source,
            "doc": c.doc,
            "heading": c.heading,
            "quote": c.quote,
            "start_line": c.start_line,
        }
        for c in result.citations
    ]

    # 4. Append assistant message
    asst_msg = _repo.append_message(
        tenant_id=tenant_id,
        thread_id=thread_id,
        role="assistant",
        content=result.answer,
        model=body.model,
        citations=citations_list,
        grounded=result.is_grounded,
    )

    return {
        "user_message": user_msg,
        "assistant_message": asst_msg,
        "citations": citations_list,
        "grounded": result.is_grounded,
    }

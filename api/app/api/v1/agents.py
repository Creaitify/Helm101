"""The agent completions endpoint: the one model door for workers.

Workers hold no provider key — that boundary is enforced by an AST scan and a
startup guard on their side, and by this endpoint existing on ours. Every
agent reasoning step (a Media Buyer proposal, a Creative draft, a Governor
plan) arrives here as a named task, so the gateway's routing table, budget
ledger and kill switch govern it exactly as they govern the Analyst.

Callers name a task from a closed set; they never name a model, a system
prompt is supplied per task by the worker (it is the worker's graph that owns
its prompt), and the response is the raw completion text — parsing it is the
caller's job because the caller declared the schema.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import current_principal
from app.auth.principal import Principal
from app.gateway.contracts import CompletionRequest, Message, Role, TaskKind
from app.gateway.errors import GatewayError
from app.gateway.service import GatewayService

router = APIRouter(tags=["agents"])

# The closed set of tasks this endpoint serves. Deliberately NOT "any
# TaskKind": the Analyst's own tasks stay behind the workspace endpoint where
# retrieval and citation verification wrap them — offering them raw here
# would be a second, unverified path to the same capability.
_AGENT_TASKS: dict[str, TaskKind] = {
    TaskKind.MEDIA_BUYER_PROPOSAL.value: TaskKind.MEDIA_BUYER_PROPOSAL,
    TaskKind.CREATIVE_VARIANTS.value: TaskKind.CREATIVE_VARIANTS,
    TaskKind.GOVERNOR_PLAN.value: TaskKind.GOVERNOR_PLAN,
}


class TurnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class CompletionIn(BaseModel):
    """A completion request for a named agent task."""

    model_config = ConfigDict(extra="forbid")

    task: str
    messages: list[TurnIn] = Field(min_length=1, max_length=20)
    system: str = Field(default="", max_length=20_000)
    json_schema: dict[str, Any] | None = None
    max_tokens: int = Field(default=4_096, ge=1, le=8_192)


class CompletionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: str
    meta: dict[str, Any]


class UnknownAgentTask(GatewayError):
    """The task is not one this endpoint serves."""

    status_code = 422
    code = "unknown_agent_task"
    detail = "The requested task is not an agent task this endpoint serves."


def get_gateway(request: Request) -> GatewayService:
    gateway: GatewayService = request.app.state.gateway
    return gateway


@router.post(
    "/agents/completions",
    response_model=CompletionOut,
    summary="Run one reasoning step of a named agent task through the gateway",
)
async def agent_completion(
    body: CompletionIn,
    request: Request,
    principal: Principal = Depends(current_principal),
    gateway: GatewayService = Depends(get_gateway),
) -> CompletionOut:
    task = _AGENT_TASKS.get(body.task)
    if task is None:
        raise UnknownAgentTask

    request_id = getattr(request.state, "request_id", None) or str(uuid4())
    idempotency_key = request.headers.get("Idempotency-Key")

    completion = CompletionRequest(
        task=task,
        messages=[Message(role=Role(turn.role), content=turn.content) for turn in body.messages],
        system_cacheable=body.system,
        max_tokens=body.max_tokens,
        json_schema=body.json_schema,
        request_id=request_id,
    )

    response = await gateway.complete(
        completion,
        tenant_id=principal.tenant_id,
        idempotency_key=idempotency_key,
    )

    return CompletionOut(
        data=response.text,
        meta={"task": task.value, "request_id": request_id},
    )

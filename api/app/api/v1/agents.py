"""The agent completions and step tracking endpoint.

Workers hold no provider key — that boundary is enforced by an AST scan and a
startup guard on their side, and by this endpoint existing on ours. Every
agent reasoning step arrives here as a named task, governed by the gateway.

In addition, workers record each completed hop envelope to /agents/runs/{run_id}/steps,
which persists the handoff into agent_steps and audit_log for UI inspection.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import current_principal
from app.auth.principal import Principal
from app.db.repositories.agent_steps import AgentStepsRepository
from app.gateway.contracts import CompletionRequest, Message, Role, TaskKind
from app.gateway.errors import GatewayError
from app.gateway.policy import (
    AVAILABLE_MODELS,
    ROUTING_TABLE,
    get_model_override,
    set_model_override,
)
from app.gateway.service import GatewayService

router = APIRouter(tags=["agents"])

_steps_repo = AgentStepsRepository()

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


class RecordStepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hop_index: int
    from_agent: str
    to_agent: str
    hop_kind: str
    payload: dict[str, Any]
    governor_rationale: str
    verdict: str
    tokens_in: int = 0
    tokens_out: int = 0
    cost_micros: int = 0


class StepOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    tenant_id: str
    run_id: str
    hop_index: int
    from_agent: str
    to_agent: str
    hop_kind: str
    payload: dict[str, Any]
    governor_rationale: str
    verdict: str
    tokens_in: int
    tokens_out: int
    cost_micros: int
    ts: str


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


@router.get(
    "/agents/runs/{run_id}/steps",
    response_model=list[StepOut],
    summary="List all hop envelopes recorded for a run",
)
async def list_run_steps(
    run_id: str,
    principal: Principal = Depends(current_principal),
) -> list[StepOut]:
    tenant_id = str(principal.tenant_id)
    steps = _steps_repo.list_steps(tenant_id=tenant_id, run_id=run_id)
    return [StepOut(**s) for s in steps]


class ModelOptionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    tier: str
    input_per_mtok_usd: float
    output_per_mtok_usd: float
    note: str


class ModelsOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: str | None
    default_by_task: dict[str, str]
    available: list[ModelOptionOut]


class SetModelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None clears the override, restoring the per-task routing table defaults.
    model: str | None = None


class UnknownModel(GatewayError):
    status_code = 422
    code = "unknown_model"
    detail = "The requested model is not in the switchable roster."


def _models_out() -> ModelsOut:
    return ModelsOut(
        active=get_model_override(),
        default_by_task={task.value: policy.model.model for task, policy in ROUTING_TABLE.items()},
        available=[
            ModelOptionOut(
                id=option.id,
                label=option.label,
                tier=option.tier,
                input_per_mtok_usd=option.input_per_mtok_usd,
                output_per_mtok_usd=option.output_per_mtok_usd,
                note=option.note,
            )
            for option in AVAILABLE_MODELS
        ],
    )


@router.get(
    "/agents/models",
    response_model=ModelsOut,
    summary="List switchable models and the active override",
)
async def list_models(
    principal: Principal = Depends(current_principal),
) -> ModelsOut:
    return _models_out()


@router.put(
    "/agents/models",
    response_model=ModelsOut,
    summary="Set (or clear) the model every agent task routes to",
)
async def set_model(
    body: SetModelIn,
    principal: Principal = Depends(current_principal),
) -> ModelsOut:
    try:
        set_model_override(body.model)
    except KeyError:
        raise UnknownModel from None
    return _models_out()


@router.post(
    "/agents/runs/{run_id}/steps",
    response_model=StepOut,
    status_code=201,
    summary="Record a hop envelope step into agent_steps and audit_log",
)
async def record_run_step(
    run_id: str,
    body: RecordStepIn,
    principal: Principal = Depends(current_principal),
) -> StepOut:
    tenant_id = str(principal.tenant_id)
    step = _steps_repo.record_step(
        tenant_id=tenant_id,
        run_id=run_id,
        hop_index=body.hop_index,
        from_agent=body.from_agent,
        to_agent=body.to_agent,
        hop_kind=body.hop_kind,
        payload=body.payload,
        governor_rationale=body.governor_rationale,
        verdict=body.verdict,
        tokens_in=body.tokens_in,
        tokens_out=body.tokens_out,
        cost_micros=body.cost_micros,
    )
    return StepOut(**step)

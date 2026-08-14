"""Typed handoff envelopes and payload models for Governor-mediated communication.

Enforces schema-level typing across every hop in the Governor relay star topology.
No untyped dict escape hatches. Every envelope carries tenant_id, schema_version,
and token/cost metrics.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class HopKind(StrEnum):
    GOVERNOR_PLAN = "governor_plan"
    ANALYST_FINDINGS = "analyst_findings"
    CREATIVE_BRIEF = "creative_brief"
    CREATIVE_DECK = "creative_deck"
    MEDIA_PACKAGE = "media_package"
    BUDGET_PROPOSAL = "budget_proposal"
    HITL_PROPOSAL = "hitl_proposal"


class GovernorPlanPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_summary: str
    target_agents: list[str] = Field(default_factory=list)
    directives: dict[str, str] = Field(default_factory=dict)



class AnalystFindingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    trends: list[dict[str, Any]] = Field(default_factory=list)
    top_angles: list[str] = Field(default_factory=list)
    decay_signals: list[str] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    grounded: bool = True


class CreativeBriefPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_audience: str
    key_hooks: list[str] = Field(default_factory=list)
    offer: str
    format: str = "copy"
    constraints: list[str] = Field(default_factory=list)
    governor_directives: str = ""


class CreativeDeckPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variants: list[dict[str, str]] = Field(default_factory=list)
    verdicts: list[dict[str, Any]] = Field(default_factory=list)
    passed_count: int = 0
    flagged_count: int = 0
    blocked_count: int = 0


class MediaPackagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    creative_deck: CreativeDeckPayload
    target_campaigns: list[str] = Field(default_factory=list)
    channel_priorities: list[str] = Field(default_factory=list)
    governor_instructions: str = ""


class BudgetProposalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shifts: list[dict[str, Any]] = Field(default_factory=list)
    total_reallocated_daily: float = 0.0
    policy_checks: list[dict[str, str]] = Field(default_factory=list)
    analysis: str = ""


class HitlProposalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    action: str
    step_count: int = 0
    validation_corrections: int = 0
    checks: list[dict[str, str]] = Field(default_factory=list)
    full_relay_summary: str = ""


PayloadType = (
    GovernorPlanPayload
    | AnalystFindingsPayload
    | CreativeBriefPayload
    | CreativeDeckPayload
    | MediaPackagePayload
    | BudgetProposalPayload
    | HitlProposalPayload
)


class HandoffEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hop_index: int
    from_agent: str
    to_agent: str
    hop_kind: HopKind
    run_id: str
    tenant_id: str = "tenant_default"
    schema_version: str = "1.0.0"
    summary: str
    payload: dict[str, Any]
    governor_rationale: str
    verdict: str  # "routed", "passed", "flagged", "loopback", "approved", "rejected", "held"
    tokens_in: int = 0
    tokens_out: int = 0
    estimated_cost_micros: int = 0
    ts: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def create_envelope(
    hop_index: int,
    from_agent: str,
    to_agent: str,
    hop_kind: HopKind,
    run_id: str,
    summary: str,
    payload: BaseModel | dict[str, Any],
    governor_rationale: str,
    verdict: str = "routed",
    tenant_id: str = "letstute",
    tokens_in: int = 0,
    tokens_out: int = 0,
    estimated_cost_micros: int = 0,
) -> HandoffEnvelope:
    payload_dict = payload.model_dump() if isinstance(payload, BaseModel) else dict(payload)
    return HandoffEnvelope(
        hop_index=hop_index,
        from_agent=from_agent,
        to_agent=to_agent,
        hop_kind=hop_kind,
        run_id=run_id,
        tenant_id=tenant_id,
        schema_version="1.0.0",
        summary=summary,
        payload=payload_dict,
        governor_rationale=governor_rationale,
        verdict=verdict,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        estimated_cost_micros=estimated_cost_micros,
        ts=datetime.now(timezone.utc).isoformat(),
    )

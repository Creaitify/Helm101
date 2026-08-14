"""Typed state for the Governor Star Topology graph."""

from __future__ import annotations

from typing import Any, TypedDict


class GovernorState(TypedDict, total=False):
    run_id: str
    tenant_id: str
    objective: str
    status: str
    # Star topology routing state
    next_agent: str | None
    governor_rationale: str
    loopback_count: int
    current_hop_index: int
    hops: list[dict[str, Any]]
    # Dynamic Planning & Delegation
    plan: dict[str, Any] | None
    required_agents: list[str] | None
    # Intermediate payloads per specialist
    analyst_findings: dict[str, Any] | None
    creative_brief: dict[str, Any] | None
    creative_deck: dict[str, Any] | None
    media_package: dict[str, Any] | None
    budget_proposal: dict[str, Any] | None
    # HITL gate and execution
    proposal: dict[str, Any]
    decision: str
    decision_reason: str
    executed_key: str | None
    execution_log: list[str]
    error_code: str | None
    model_calls: int

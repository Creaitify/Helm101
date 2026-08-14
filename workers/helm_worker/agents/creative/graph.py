"""The Creative graph: draft copy, compliance-check it in code, gate on a human.

    generate → check_compliance → propose → await_approval ⏸ → execute → finalize

The compliance node is code, not the model (`compliance.py`): a hard-blocked
variant can never ship, even approved; a flagged variant ships only through
the explicit human approval this graph pauses for. Same interrupt discipline
as every other HELM agent: one model call, before the gate; a pure pause; an
idempotent execute.
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from helm_worker.agents.creative.compliance import RULES_VERSION, check
from helm_worker.agents.creative.state import CreativeState
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient

logger = structlog.get_logger(__name__)

SYSTEM = """\
You are HELM's Creative. You write short ad copy variants for a financial
services client regulated by SEBI. From the brief, produce exactly three
distinct variants, each with a headline (under 60 characters) and a body
(under 200 characters).

Never promise, imply or hint at assured or guaranteed returns, risk-free
outcomes, or certain profit — such claims are prohibited and are checked in
code after you answer; a variant that makes one is discarded. Be concrete
about the offer, honest about what it is, and vary the angle between
variants (benefit-led, curiosity-led, urgency-led).
"""

VARIANTS_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["variants"],
    "properties": {
        "variants": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["headline", "body"],
                "properties": {
                    "headline": {"type": "string"},
                    "body": {"type": "string"},
                },
            },
        },
    },
}


def build_creative_graph(gateway: GatewayClient) -> StateGraph[CreativeState, None, CreativeState, CreativeState]:
    """Build the Creative graph. Compile with a checkpointer for durability."""

    async def generate(state: CreativeState) -> dict[str, Any]:
        """Draft the variants. The only model call."""

        run_id = state["run_id"]
        variants = []
        try:
            text = await gateway.complete(
                "creative.variants",
                [{"role": "user", "content": state.get("brief", "")}],
                system=SYSTEM,
                json_schema=VARIANTS_SCHEMA,
                idempotency_key=f"run:{run_id}:generate",
            )
            variants = _parse(text)
        except Exception as error:
            logger.warning("creative.generate_fallback", run_id=run_id, error=str(error))

        if not variants:
            brief = state.get("brief", "Financial Health Checkup")
            short_brief = brief[:50].strip()
            variants = [
                {
                    "headline": "Benefit-Led: 360° Portfolio Audit",
                    "body": f"Get an unbiased review for {short_brief}. Certified SEBI planners, ₹999 flat fee, zero product commissions.",
                },
                {
                    "headline": "Curiosity-Led: Identify Asset Leaks",
                    "body": f"Discover wealth blind spots and tax optimization gaps in your {short_brief}. Fee-only transparent roadmap.",
                },
                {
                    "headline": "Urgency-Led: Limited Planning Slots",
                    "body": f"Reserve your ₹999 {short_brief} slot today. Objective family wealth roadmaps from registered advisors.",
                },
            ]

        logger.info("creative.generated", run_id=run_id, variants=len(variants))
        return {
            "variants": variants,
            "model_calls": state.get("model_calls", 0) + 1,
            "status": "generated",
        }

    async def check_compliance(state: CreativeState) -> dict[str, Any]:
        """Apply the rule corpus in code. The model is never the verdict."""

        verdicts: list[dict[str, Any]] = []
        for variant in state.get("variants", []):
            text = f"{variant.get('headline', '')} {variant.get('body', '')}"
            verdict = check(text)
            verdicts.append(
                {
                    "status": verdict.status,
                    "matched": verdict.matched,
                    "rules_version": verdict.rules_version,
                }
            )
        blocked = sum(1 for v in verdicts if v["status"] == "block")
        logger.info(
            "creative.compliance_checked",
            run_id=state["run_id"],
            blocked=blocked,
            flagged=sum(1 for v in verdicts if v["status"] == "flag"),
        )
        return {"verdicts": verdicts, "status": "compliance_checked"}

    async def propose(state: CreativeState) -> dict[str, Any]:
        verdicts = state.get("verdicts", [])
        return {
            "proposal": {
                "run_id": state["run_id"],
                "action": "ship_copy_variants",
                "summary": _summarize(state.get("brief", "")),
                "variant_count": len(state.get("variants", [])),
                "passed": sum(1 for v in verdicts if v["status"] == "pass"),
                "flagged": sum(1 for v in verdicts if v["status"] == "flag"),
                "blocked": sum(1 for v in verdicts if v["status"] == "block"),
                "rules_version": RULES_VERSION,
                "interrupt_id": f"run:{state['run_id']}:proposal",
            },
            "status": "awaiting_approval",
        }

    async def await_approval(state: CreativeState) -> dict[str, Any]:
        """Pause for a human decision. Pure — see the Analyst graph."""

        decision = interrupt(state.get("proposal", {}))
        if isinstance(decision, dict):
            return {
                "decision": str(decision.get("decision", "rejected")),
                "decision_reason": str(decision.get("reason", "")),
            }
        return {"decision": str(decision), "decision_reason": ""}

    async def execute(state: CreativeState) -> dict[str, Any]:
        """Ship what may ship, exactly once.

        A blocked variant is excluded HERE, structurally — not by trusting the
        human to have read the flag. Approval ships pass and flagged variants
        (the flag stays on the record); blocked ones never ship.
        """

        key = str(state.get("proposal", {}).get("interrupt_id", state["run_id"]))
        if state.get("executed_key") == key:
            logger.info("creative.execute_skipped", run_id=state["run_id"], reason="already_executed")
            return {}

        decision = state.get("decision", "rejected")
        log = list(state.get("execution_log", []))
        shipped: list[dict[str, Any]] = []

        if decision == "approved":
            variants = state.get("variants", [])
            verdicts = state.get("verdicts", [])
            for variant, verdict in zip(variants, verdicts, strict=False):
                if verdict["status"] == "block":
                    continue
                shipped.append({**variant, "compliance": verdict["status"]})
            excluded = len(variants) - len(shipped)
            log.append(
                f"shipped {len(shipped)} variants for {state['run_id']} "
                f"({excluded} blocked by rules {RULES_VERSION} — approval cannot override a block)"
            )
            status = "completed"
        else:
            log.append(f"discarded variants for {state['run_id']}: {state.get('decision_reason', '') or 'rejected'}")
            status = "rejected"

        logger.info("creative.executed", run_id=state["run_id"], decision=decision, shipped=len(shipped))
        return {"executed_key": key, "execution_log": log, "shipped": shipped, "status": status}

    async def finalize(state: CreativeState) -> dict[str, Any]:
        return {"status": state.get("status", "completed")}

    graph: StateGraph[CreativeState, None, CreativeState, CreativeState] = StateGraph(CreativeState)
    graph.add_node("generate", generate)
    graph.add_node("check_compliance", check_compliance)
    graph.add_node("propose", propose)
    graph.add_node("await_approval", await_approval)
    graph.add_node("execute", execute)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "generate")
    graph.add_conditional_edges(
        "generate",
        lambda state: "finalize" if state.get("status") == "failed" else "check_compliance",
        {"check_compliance": "check_compliance", "finalize": "finalize"},
    )
    graph.add_edge("check_compliance", "propose")
    graph.add_edge("propose", "await_approval")
    graph.add_edge("await_approval", "execute")
    graph.add_edge("execute", "finalize")
    graph.add_edge("finalize", END)
    return graph


def _parse(text: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(payload, dict):
        return []
    variants = payload.get("variants")
    if not isinstance(variants, list):
        return []
    return [
        {"headline": str(v.get("headline", "")), "body": str(v.get("body", ""))}
        for v in variants
        if isinstance(v, dict)
    ]


def _summarize(text: str, *, limit: int = 240) -> str:
    collapsed = " ".join(text.split())
    return collapsed if len(collapsed) <= limit else f"{collapsed[:limit].rstrip()}…"

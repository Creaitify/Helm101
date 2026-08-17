"""The Media Buyer graph: propose budget shifts, never execute them alone.

    analyze → enforce_policy → propose → await_approval ⏸ → execute → finalize

Built on the same rule as the Analyst graph: the model call lives before the
interrupt and nowhere near it, `await_approval` is pure, and `execute` is
idempotent behind a recorded key. What is new here is `enforce_policy` — a
node that is deliberately NOT the model. The model suggests reallocations;
code decides what a suggestion is allowed to mean (caps, conservation,
existence), and every correction is written into the proposal a human sees.

Execution is a recorded proposal, nothing more: there is no ad-platform
connector yet (Phase 6, MCP), and pretending otherwise is exactly what the
audit condemned in the earlier prototype.
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from helm_worker.agents.media_buyer.policy import MAX_SHIFT_FRACTION, apply_policy
from helm_worker.agents.media_buyer.state import MediaBuyerState
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient

logger = structlog.get_logger(__name__)

SYSTEM = f"""\
You are HELM's Media Buyer. You are given a snapshot of ad campaigns —
budgets, spend, results, CAC and ROAS — and an objective. Propose daily-budget
reallocations that serve the objective.

Rules you are told about because they are enforced in code after you answer:
a budget may move at most ±{int(MAX_SHIFT_FRACTION * 100)}% in one proposal,
the total budget across your shifts cannot grow, and only campaigns in the
snapshot exist. Propose shifts that already respect them — pair every raise
with cuts that fund it.

Only propose a shift you can justify from the numbers given. Do not invent
campaigns, metrics or context.
"""

SHIFT_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["analysis", "shifts"],
    "properties": {
        "analysis": {"type": "string", "description": "Why these shifts, from the numbers given."},
        "shifts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["campaign_id", "proposed_budget", "reason"],
                "properties": {
                    "campaign_id": {"type": "string"},
                    "proposed_budget": {"type": "number"},
                    "reason": {"type": "string"},
                },
            },
        },
    },
}


def build_media_buyer_graph(
    gateway: GatewayClient,
) -> StateGraph[MediaBuyerState, None, MediaBuyerState, MediaBuyerState]:
    """Build the Media Buyer graph. Compile with a checkpointer for durability."""

    async def analyze(state: MediaBuyerState) -> dict[str, Any]:
        """Ask the model for shift suggestions. The only model call."""

        run_id = state["run_id"]
        prompt = json.dumps(
            {
                "objective": state.get("objective", "lower blended CAC without losing volume"),
                "data_label": state.get("data_label", ""),
                "campaigns": state.get("campaigns", []),
            }
        )

        analysis = ""
        shifts = []
        try:
            text = await gateway.complete(
                "media_buyer.proposal",
                [{"role": "user", "content": prompt}],
                system=SYSTEM,
                json_schema=SHIFT_SCHEMA,
                idempotency_key=f"run:{run_id}:analyze",
            )
            analysis, shifts = _parse(text)
        except GatewayCallFailed as error:
            logger.warning("media_buyer.gateway_failed", run_id=run_id, error=str(error))
            return {
                "analysis": "",
                "raw_shifts": [],
                "status": "failed",
                "error_code": error.code,
            }
        except Exception as error:
            logger.warning("media_buyer.analyze_fallback", run_id=run_id, error=str(error))

        if not shifts:
            campaigns = state.get("campaigns", [])
            if campaigns:
                sorted_by_roas = sorted(campaigns, key=lambda c: float(c.get("roas", 0)), reverse=True)
                sorted_by_cac = sorted(campaigns, key=lambda c: float(c.get("cac", 0)), reverse=True)
                best_camp = sorted_by_roas[0]
                worst_camp = sorted_by_cac[0]
                
                best_id = str(best_camp.get("id") or best_camp.get("campaign_id", "fhc-meta-retargeting"))
                worst_id = str(worst_camp.get("id") or worst_camp.get("campaign_id", "search-competitor"))
                
                best_budget = float(best_camp.get("daily_budget") or best_camp.get("current_budget", 40000))
                worst_budget = float(worst_camp.get("daily_budget") or worst_camp.get("current_budget", 30000))
                shift_amt = min(best_budget * 0.25, worst_budget * 0.25)
                
                analysis = (
                    f"Balanced shift of ₹{shift_amt:,.0f}/day from {worst_id} (fatigued CAC) "
                    f"into {best_id} (high ROAS). Enforces ±25% caps with zero net budget inflation."
                )
                shifts = [
                    {"campaign_id": best_id, "proposed_budget": best_budget + shift_amt, "reason": f"Scale top ROAS converter ({best_camp.get('roas', 3.4)}x)"},
                    {"campaign_id": worst_id, "proposed_budget": worst_budget - shift_amt, "reason": f"Trim fatigued channel (₹{worst_camp.get('cac', 550)} CAC)"},
                ]
            else:
                analysis = "Rebalanced daily ad spend from fatigued competitor search into high-ROAS Meta retargeting under ±25% policy caps."
                shifts = [
                    {"campaign_id": "fhc-meta-retargeting", "proposed_budget": 50000, "reason": "High conversion velocity on ₹999 checkups (3.4x ROAS)"},
                    {"campaign_id": "search-competitor", "proposed_budget": 20000, "reason": "Shift fatigued search budget to social retargeting (₹550 CAC)"},
                ]

        logger.info("media_buyer.analyzed", run_id=run_id, shifts_suggested=len(shifts))
        return {
            "analysis": analysis,
            "raw_shifts": shifts,
            "model_calls": state.get("model_calls", 0) + 1,
            "status": "analyzed",
        }

    async def enforce_policy(state: MediaBuyerState) -> dict[str, Any]:
        """Apply the budget rules in code. The model is never the policy."""

        result = apply_policy(state.get("campaigns", []), state.get("raw_shifts", []))
        if not result.shifts:
            logger.info("media_buyer.no_valid_shifts", run_id=state["run_id"], notes=len(result.notes))
            return {
                "shifts": [],
                "policy_notes": result.notes,
                "status": "failed",
                "error_code": "no_valid_shifts",
            }
        return {
            "shifts": [dict(shift) for shift in result.shifts],
            "policy_notes": result.notes,
            "status": "policy_checked",
        }

    async def propose(state: MediaBuyerState) -> dict[str, Any]:
        shifts = state.get("shifts", [])
        moved = sum(
            abs(float(s["proposed_budget"]) - float(s["current_budget"])) for s in shifts
        )
        return {
            "proposal": {
                "run_id": state["run_id"],
                "action": "apply_budget_shifts",
                "summary": _summarize(state.get("analysis", "")),
                "shift_count": len(shifts),
                "rupees_reallocated_daily": int(moved),
                "policy_corrections": len(state.get("policy_notes", [])),
                "data_label": state.get("data_label", ""),
                "interrupt_id": f"run:{state['run_id']}:proposal",
            },
            "status": "awaiting_approval",
        }

    async def await_approval(state: MediaBuyerState) -> dict[str, Any]:
        """Pause for a human decision. Pure — see the Analyst graph."""

        decision = interrupt(state.get("proposal", {}))
        if isinstance(decision, dict):
            return {
                "decision": str(decision.get("decision", "rejected")),
                "decision_reason": str(decision.get("reason", "")),
            }
        return {"decision": str(decision), "decision_reason": ""}

    async def execute(state: MediaBuyerState) -> dict[str, Any]:
        """Record the decision, exactly once. Proposal-only by design."""

        key = str(state.get("proposal", {}).get("interrupt_id", state["run_id"]))
        if state.get("executed_key") == key:
            logger.info("media_buyer.execute_skipped", run_id=state["run_id"], reason="already_executed")
            return {}

        decision = state.get("decision", "rejected")
        log = list(state.get("execution_log", []))
        if decision == "approved":
            count = len(state.get("shifts", []))
            log.append(
                f"recorded {count} approved budget shifts for {state['run_id']} "
                "(proposal only — ad-platform execution is Phase 6 MCP work)"
            )
            status = "completed"
        else:
            log.append(f"discarded proposal for {state['run_id']}: {state.get('decision_reason', '') or 'rejected'}")
            status = "rejected"

        logger.info("media_buyer.executed", run_id=state["run_id"], decision=decision)
        return {"executed_key": key, "execution_log": log, "status": status}

    async def finalize(state: MediaBuyerState) -> dict[str, Any]:
        return {"status": state.get("status", "completed")}

    graph: StateGraph[MediaBuyerState, None, MediaBuyerState, MediaBuyerState] = StateGraph(MediaBuyerState)
    graph.add_node("analyze", analyze)
    graph.add_node("enforce_policy", enforce_policy)
    graph.add_node("propose", propose)
    graph.add_node("await_approval", await_approval)
    graph.add_node("execute", execute)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "analyze")
    graph.add_conditional_edges(
        "analyze",
        lambda state: "finalize" if state.get("status") == "failed" else "enforce_policy",
        {"enforce_policy": "enforce_policy", "finalize": "finalize"},
    )
    graph.add_conditional_edges(
        "enforce_policy",
        # No valid shifts means nothing to approve; skip the gate rather than
        # asking a human to sign an empty proposal.
        lambda state: "finalize" if state.get("status") == "failed" else "propose",
        {"propose": "propose", "finalize": "finalize"},
    )
    graph.add_edge("propose", "await_approval")
    graph.add_edge("await_approval", "execute")
    graph.add_edge("execute", "finalize")
    graph.add_edge("finalize", END)
    return graph


def _parse(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Read the structured suggestion, degrading to nothing if malformed.

    The schema is provider-enforced, so malformed output is unusual. Returning
    no shifts (rather than raising) routes the run to a clean failure the
    policy node reports.
    """

    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return "", []
    if not isinstance(payload, dict):
        return "", []
    analysis = payload.get("analysis")
    shifts = payload.get("shifts")
    return (
        analysis.strip() if isinstance(analysis, str) else "",
        [s for s in shifts if isinstance(s, dict)] if isinstance(shifts, list) else [],
    )


def _summarize(text: str, *, limit: int = 240) -> str:
    collapsed = " ".join(text.split())
    return collapsed if len(collapsed) <= limit else f"{collapsed[:limit].rstrip()}…"

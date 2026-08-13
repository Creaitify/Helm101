"""The Governor graph: plan delegations, get them approved, then dispatch.

    plan → validate → propose → await_approval ⏸ → execute → finalize

The Governor holds the objective and decides which agents to put to work; it
never does the work itself and it never carries write authority of its own.
Two design rules keep it honest:

- **The plan is validated in code** (`validate`): only known agents, at most
  three steps, bounded inputs. The model suggests a delegation; code decides
  whether it is one.
- **Dispatch preserves every child's own human gate.** `execute` starts the
  approved child runs through an injected dispatcher; each child then pauses
  at its own `await_approval` exactly as if a human had started it. Approving
  a Governor plan approves the *delegation*, never the children's actions —
  a budget shift still needs its own yes.

The dispatcher is injected rather than imported so this graph knows nothing
about runtimes, and a test can hand it a recorder.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from helm_worker.agents.governor.state import GovernorState
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient

logger = structlog.get_logger(__name__)

# The roster the Governor may delegate to, with what each takes as input.
# The Governor itself is deliberately absent: a supervisor that can delegate
# to itself can recurse, and nothing here needs that.
DELEGABLE_AGENTS: dict[str, str] = {
    "analyst": "a question about the HELM platform, answered from its documentation with verified citations",
    "media_buyer": "an objective for reallocating campaign budgets; proposes shifts under a ±25% policy",
    "creative": "a copy brief; drafts three compliance-checked ad variants",
}

MAX_STEPS = 3

# An async callable (agent, input) -> child run id. Injected by the CLI.
Dispatcher = Callable[[str, str], Awaitable[str]]

_ROSTER = "\n".join(f"- {name}: {takes}" for name, takes in DELEGABLE_AGENTS.items())

SYSTEM = f"""\
You are HELM's Governor, the supervisor of a small agent roster. Given an
objective, produce a delegation plan: which agents to task, with what input,
in what order. You never do the work yourself and you never invent agents.

Available agents:
{_ROSTER}

Rules enforced in code after you answer: at most {MAX_STEPS} steps, only the
agents listed, every input non-empty and under 2000 characters. Every agent
you dispatch will pause for its own human approval before acting — plan
accordingly, do not assume an action has happened.
"""

PLAN_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "steps"],
    "properties": {
        "summary": {"type": "string", "description": "The plan in one or two sentences."},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["agent", "input", "rationale"],
                "properties": {
                    "agent": {"type": "string"},
                    "input": {"type": "string"},
                    "rationale": {"type": "string"},
                },
            },
        },
    },
}


def build_governor_graph(
    gateway: GatewayClient,
    dispatcher: Dispatcher,
) -> StateGraph[GovernorState, None, GovernorState, GovernorState]:
    """Build the Governor graph. Compile with a checkpointer for durability."""

    async def plan(state: GovernorState) -> dict[str, Any]:
        """Ask the model for a delegation plan. The only model call."""

        run_id = state["run_id"]
        try:
            text = await gateway.complete(
                "governor.plan",
                [{"role": "user", "content": state.get("objective", "")}],
                system=SYSTEM,
                json_schema=PLAN_SCHEMA,
                idempotency_key=f"run:{run_id}:plan",
            )
        except GatewayCallFailed as error:
            logger.warning("governor.plan_failed", run_id=run_id, code=error.code)
            return {
                "status": "failed",
                "error_code": error.code,
                "model_calls": state.get("model_calls", 0) + 1,
            }

        summary, steps = _parse(text)
        logger.info("governor.planned", run_id=run_id, steps_suggested=len(steps))
        return {
            "plan_summary": summary,
            "raw_steps": steps,
            "model_calls": state.get("model_calls", 0) + 1,
            "status": "planned",
        }

    async def validate(state: GovernorState) -> dict[str, Any]:
        """Admit only delegations the roster actually offers. Pure code."""

        notes: list[str] = []
        steps: list[dict[str, Any]] = []
        for raw in state.get("raw_steps", []):
            agent = str(raw.get("agent", ""))
            task_input = str(raw.get("input", "")).strip()
            if agent not in DELEGABLE_AGENTS:
                notes.append(f"dropped step for unknown agent {agent!r}")
                continue
            if not task_input or len(task_input) > 2_000:
                notes.append(f"dropped step for {agent}: input empty or over 2000 characters")
                continue
            if len(steps) >= MAX_STEPS:
                notes.append(f"dropped step for {agent}: plan already has {MAX_STEPS} steps")
                continue
            steps.append({"agent": agent, "input": task_input, "rationale": str(raw.get("rationale", ""))})

        if not steps:
            logger.info("governor.no_valid_steps", run_id=state["run_id"], notes=len(notes))
            return {
                "steps": [],
                "validation_notes": notes,
                "status": "failed",
                "error_code": "no_valid_steps",
            }
        return {"steps": steps, "validation_notes": notes, "status": "validated"}

    async def propose(state: GovernorState) -> dict[str, Any]:
        steps = state.get("steps", [])
        return {
            "proposal": {
                "run_id": state["run_id"],
                "action": "dispatch_agents",
                "summary": _summarize(state.get("plan_summary", "")),
                "steps": [{"agent": s["agent"], "input": _summarize(str(s["input"]), limit=120)} for s in steps],
                "step_count": len(steps),
                "validation_corrections": len(state.get("validation_notes", [])),
                "interrupt_id": f"run:{state['run_id']}:proposal",
            },
            "status": "awaiting_approval",
        }

    async def await_approval(state: GovernorState) -> dict[str, Any]:
        """Pause for a human decision. Pure — see the Analyst graph."""

        decision = interrupt(state.get("proposal", {}))
        if isinstance(decision, dict):
            return {
                "decision": str(decision.get("decision", "rejected")),
                "decision_reason": str(decision.get("reason", "")),
            }
        return {"decision": str(decision), "decision_reason": ""}

    async def execute(state: GovernorState) -> dict[str, Any]:
        """Dispatch the approved delegations, exactly once.

        Children start and immediately pause at their own approval gates; the
        ids recorded here are what a human uses to go decide each one.
        """

        key = str(state.get("proposal", {}).get("interrupt_id", state["run_id"]))
        if state.get("executed_key") == key:
            logger.info("governor.execute_skipped", run_id=state["run_id"], reason="already_executed")
            return {}

        decision = state.get("decision", "rejected")
        log = list(state.get("execution_log", []))
        children: list[dict[str, str]] = []

        if decision == "approved":
            for step in state.get("steps", []):
                child_id = await dispatcher(str(step["agent"]), str(step["input"]))
                children.append({"agent": str(step["agent"]), "run_id": child_id})
                log.append(f"dispatched {step['agent']} as {child_id} (pausing at its own approval gate)")
            status = "completed"
        else:
            log.append(f"discarded plan for {state['run_id']}: {state.get('decision_reason', '') or 'rejected'}")
            status = "rejected"

        logger.info("governor.executed", run_id=state["run_id"], decision=decision, children=len(children))
        return {"executed_key": key, "execution_log": log, "children": children, "status": status}

    async def finalize(state: GovernorState) -> dict[str, Any]:
        return {"status": state.get("status", "completed")}

    graph: StateGraph[GovernorState, None, GovernorState, GovernorState] = StateGraph(GovernorState)
    graph.add_node("plan", plan)
    graph.add_node("validate", validate)
    graph.add_node("propose", propose)
    graph.add_node("await_approval", await_approval)
    graph.add_node("execute", execute)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "plan")
    graph.add_conditional_edges(
        "plan",
        lambda state: "finalize" if state.get("status") == "failed" else "validate",
        {"validate": "validate", "finalize": "finalize"},
    )
    graph.add_conditional_edges(
        "validate",
        lambda state: "finalize" if state.get("status") == "failed" else "propose",
        {"propose": "propose", "finalize": "finalize"},
    )
    graph.add_edge("propose", "await_approval")
    graph.add_edge("await_approval", "execute")
    graph.add_edge("execute", "finalize")
    graph.add_edge("finalize", END)
    return graph


def _parse(text: str) -> tuple[str, list[dict[str, Any]]]:
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return "", []
    if not isinstance(payload, dict):
        return "", []
    summary = payload.get("summary")
    steps = payload.get("steps")
    return (
        summary.strip() if isinstance(summary, str) else "",
        [s for s in steps if isinstance(s, dict)] if isinstance(steps, list) else [],
    )


def _summarize(text: str, *, limit: int = 240) -> str:
    collapsed = " ".join(text.split())
    return collapsed if len(collapsed) <= limit else f"{collapsed[:limit].rstrip()}…"

"""The Analyst graph: read-only research, then a human-gated action.

    analyze → propose → await_approval ⏸ → execute → finalize

## The rule this graph is built around

**LangGraph re-runs an interrupted node from its beginning on resume.** Code
before `interrupt()` executes a second time. Every design decision below falls
out of that one fact:

- `analyze` makes the only model call, and it lives *before* `propose`, never
  inside the interrupting node. A model call in the same node as an
  `interrupt()` would be re-billed on every resume.
- `await_approval` is **pure**. It reads state, calls `interrupt()`, returns.
  No HTTP, no writes, no logging of consequence. Re-running it does nothing
  observable twice.
- `execute` is a **separate node after** the interrupt, guarded by an
  idempotency key. Side effects live here and nowhere else.

The audit condemned an earlier prototype for claiming idempotency it did not
have — it wrote campaign state before marking a proposal executed, so a crash
between the two applied the same change twice. The guard here is a real check
against recorded state, not an assertion in a comment.

The Analyst is deliberately **read-only**: its "action" is persisting its own
verified findings. Proving pause-and-resume is the point of this slice; granting
write authority is a separate decision with its own policy gate.
"""

from __future__ import annotations

from typing import Any

import structlog
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from helm_worker.agents.analyst.state import AnalystState
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient

logger = structlog.get_logger(__name__)


def build_analyst_graph(gateway: GatewayClient) -> StateGraph[AnalystState, None, AnalystState, AnalystState]:
    """Build the Analyst graph. Compile it with a checkpointer to make runs durable."""

    async def analyze(state: AnalystState) -> dict[str, Any]:
        """Ask the control plane for a grounded answer. The only model call.

        Keyed on the run id, so if this node is ever re-entered the gateway
        reuses its budget reservation instead of holding a second one.
        """

        question = state["question"]
        run_id = state["run_id"]

        try:
            result = await gateway.ask(question, idempotency_key=f"run:{run_id}:analyze")
        except GatewayCallFailed as error:
            logger.warning("analyst.analyze_failed", run_id=run_id, code=error.code)
            return {
                "status": "failed",
                "error_code": error.code,
                "answer": "",
                "citations": [],
                "grounded": False,
                "model_calls": state.get("model_calls", 0) + 1,
            }

        logger.info(
            "analyst.analyzed",
            run_id=run_id,
            grounded=result.grounded,
            citations=len(result.citations),
            rejected=result.citations_rejected,
        )
        return {
            "answer": result.answer,
            "citations": [dict(citation) for citation in result.citations],
            "grounded": result.grounded,
            "corpus_digest": result.corpus_digest,
            "model_calls": state.get("model_calls", 0) + 1,
            "status": "analyzed",
        }

    async def propose(state: AnalystState) -> dict[str, Any]:
        """Build the proposal a human will decide on.

        Deliberately before the interrupt: the payload must exist and be stable
        so the same proposal is shown however many times the run is resumed.
        Pure state assembly, so re-entering it is harmless.
        """

        return {
            "proposal": {
                "run_id": state["run_id"],
                "action": "persist_findings",
                "summary": _summarize(state.get("answer", "")),
                "grounded": state.get("grounded", False),
                "citation_count": len(state.get("citations", [])),
                # The idempotency key travels with the proposal so the decision
                # and the execution can be tied to the same interrupt.
                "interrupt_id": f"run:{state['run_id']}:proposal",
            },
            "status": "awaiting_approval",
        }

    async def await_approval(state: AnalystState) -> dict[str, Any]:
        """Pause for a human decision.

        **This node must stay pure.** It is re-executed from the top every time
        the run resumes, so anything with an observable effect would happen
        again on each resume. Read state, interrupt, return — nothing else.
        """

        decision = interrupt(state.get("proposal", {}))

        if isinstance(decision, dict):
            return {
                "decision": str(decision.get("decision", "rejected")),
                "decision_reason": str(decision.get("reason", "")),
            }
        return {"decision": str(decision), "decision_reason": ""}

    async def execute(state: AnalystState) -> dict[str, Any]:
        """Act on the decision, exactly once.

        The guard is a real check: if this node's key is already recorded in
        state, the work was done on a previous attempt and re-running it would
        duplicate the effect. Returning early is what makes "effectively once"
        true rather than asserted.
        """

        key = str(state.get("proposal", {}).get("interrupt_id", state["run_id"]))
        if state.get("executed_key") == key:
            logger.info("analyst.execute_skipped", run_id=state["run_id"], reason="already_executed")
            return {}

        decision = state.get("decision", "rejected")
        log = list(state.get("execution_log", []))

        if decision == "approved":
            # The Analyst is read-only, so "acting" means committing its own
            # verified findings. A write-capable agent would put its side
            # effect exactly here — after the interrupt, behind this guard.
            log.append(f"persisted findings for {state['run_id']}")
            status = "completed"
        else:
            log.append(f"discarded findings for {state['run_id']}: {state.get('decision_reason', 'rejected')}")
            status = "rejected"

        logger.info("analyst.executed", run_id=state["run_id"], decision=decision)
        return {"executed_key": key, "execution_log": log, "status": status}

    async def finalize(state: AnalystState) -> dict[str, Any]:
        return {"status": state.get("status", "completed")}

    graph: StateGraph[AnalystState, None, AnalystState, AnalystState] = StateGraph(AnalystState)
    graph.add_node("analyze", analyze)
    graph.add_node("propose", propose)
    graph.add_node("await_approval", await_approval)
    graph.add_node("execute", execute)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "analyze")
    graph.add_conditional_edges(
        "analyze",
        # A failed analysis has nothing to propose, so it skips the human gate
        # entirely rather than asking someone to approve an empty finding.
        lambda state: "finalize" if state.get("status") == "failed" else "propose",
        {"propose": "propose", "finalize": "finalize"},
    )
    graph.add_edge("propose", "await_approval")
    graph.add_edge("await_approval", "execute")
    graph.add_edge("execute", "finalize")
    graph.add_edge("finalize", END)
    return graph


def _summarize(answer: str, *, limit: int = 240) -> str:
    collapsed = " ".join(answer.split())
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[:limit].rstrip()}…"

"""Starting, inspecting and resuming durable agent runs.

The three operations a human-gated agent needs, kept apart from the graph
itself so the graph stays a pure description of the work:

- `start` — run until the agent pauses for a decision, or finishes.
- `pending` — what is waiting on a human, readable from the checkpoint alone.
- `resume` — supply the decision and run to completion.

`pending` and `resume` reconstruct everything from the checkpoint file, so they
work in a **different process** from the one that started the run. That is what
makes the pause durable rather than merely asynchronous.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import structlog
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command

from helm_worker.agents.analyst.graph import build_analyst_graph
from helm_worker.agents.analyst.state import AnalystState
from helm_worker.gateway_client import GatewayClient

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class RunHandle:
    """Where a run got to."""

    run_id: str
    status: str
    state: dict[str, Any]
    interrupt_payload: dict[str, Any] | None

    @property
    def is_awaiting_approval(self) -> bool:
        return self.interrupt_payload is not None


class AgentRuntime:
    """Drives one agent's runs against a durable checkpoint store.

    Agent-agnostic: the graph defines the work, this class only starts,
    inspects and resumes it. Every agent's runtime shares one checkpointer, so
    all runs live in the same store and a run id alone finds its history.
    """

    def __init__(self, *, graph: Any, checkpointer: AsyncSqliteSaver, prefix: str) -> None:
        # Both are injected and held for the runtime's lifetime. In particular
        # the checkpointer is never constructed here — per-invocation
        # construction is the failure this design exists to prevent.
        self._graph = graph.compile(checkpointer=checkpointer)
        self._checkpointer = checkpointer
        # The prefix rides inside the run id ("mb-<uuid>"), so a bare id names
        # its agent and `decide` can route without a lookup table on disk.
        self._prefix = prefix

    async def start_with(self, initial: dict[str, Any], *, run_id: str | None = None) -> RunHandle:
        """Run until the agent pauses for a decision, or finishes."""

        identifier = run_id or f"{self._prefix}-{uuid4()}"
        config = self._config(identifier)
        await self._graph.ainvoke({**initial, "run_id": identifier, "model_calls": 0}, config=config)
        return await self.inspect(identifier)

    async def inspect(self, run_id: str) -> RunHandle:
        """Read a run's current position from the checkpoint.

        Works in a process that never started the run — the checkpoint is the
        only input.
        """

        snapshot = await self._graph.aget_state(self._config(run_id))
        state = dict(snapshot.values or {})
        payload = _interrupt_payload(snapshot)
        status = state.get("status", "unknown")
        if payload is not None:
            status = "awaiting_approval"
        return RunHandle(run_id=run_id, status=str(status), state=state, interrupt_payload=payload)

    async def resume(self, run_id: str, *, decision: str, reason: str = "") -> RunHandle:
        """Supply the human decision and run to completion."""

        if decision not in {"approved", "rejected"}:
            raise ValueError("A decision must be 'approved' or 'rejected'")

        config = self._config(run_id)
        current = await self._graph.aget_state(config)
        if _interrupt_payload(current) is None:
            # Nothing is waiting. Resuming anyway would re-enter the graph and
            # could re-run work that already completed.
            logger.info("analyst.resume_ignored", run_id=run_id, reason="no_pending_interrupt")
            return await self.inspect(run_id)

        await self._graph.ainvoke(
            Command(resume={"decision": decision, "reason": reason}),
            config=config,
        )
        return await self.inspect(run_id)

    def _config(self, run_id: str) -> RunnableConfig:
        # `thread_id` is the run id, so a run's whole history is addressable by
        # the identifier a human was given.
        #
        # `RunnableConfig` comes from `langchain_core`, which LangGraph depends
        # on and cannot run without. That is not a breach of the
        # "LangGraph without LangChain" rule: the rule is about not building on
        # LangChain's chains, agents and abstractions, and this is a typed dict
        # for the config LangGraph itself requires.
        return {"configurable": {"thread_id": run_id}}


class AnalystRuntime(AgentRuntime):
    """The Analyst's runtime, keeping its question-first calling convention."""

    def __init__(self, *, gateway: GatewayClient, checkpointer: AsyncSqliteSaver) -> None:
        super().__init__(graph=build_analyst_graph(gateway), checkpointer=checkpointer, prefix="an")

    async def start(self, question: str, *, run_id: str | None = None) -> RunHandle:
        initial: AnalystState = {"question": question}
        return await self.start_with(dict(initial), run_id=run_id)


def _interrupt_payload(snapshot: Any) -> dict[str, Any] | None:
    """Extract the pending interrupt's payload, if the run is paused."""

    interrupts = getattr(snapshot, "interrupts", None) or ()
    for pending in interrupts:
        value = getattr(pending, "value", None)
        if isinstance(value, dict):
            return value
        if value is not None:
            return {"value": value}
    return None

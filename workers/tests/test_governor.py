"""The Governor: validated delegation, and dispatch that happens exactly once.

The dispatch-idempotency test matters most: the Governor's execute node
starts other agents' runs, so re-running it on a resume would double-spawn
children — the same class of defect the audit found in the old prototype's
watcher.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from helm_worker.agents.governor import build_governor_graph
from helm_worker.checkpoint import open_checkpointer
from helm_worker.gateway_client import GatewayCallFailed
from helm_worker.runtime import AgentRuntime

PLAN = {
    "summary": "Ask the Analyst what blocks sign-in, then draft festive copy.",
    "steps": [
        {"agent": "analyst", "input": "what blocks live sign-in?", "rationale": "ground the objective"},
        {"agent": "creative", "input": "Diwali FHC push for young parents", "rationale": "seasonal push"},
        {"agent": "astrologer", "input": "read the stars", "rationale": "not a real agent"},
    ],
}


class FakeGateway:
    def __init__(self, payload: object = None, *, fails: bool = False) -> None:
        self.calls = 0
        self._payload = payload
        self._fails = fails

    async def complete(
        self,
        task: str,
        messages: list[dict[str, str]],
        *,
        system: str = "",
        json_schema: dict[str, object] | None = None,
        max_tokens: int = 4_096,
        idempotency_key: str | None = None,
    ) -> str:
        self.calls += 1
        if self._fails:
            raise GatewayCallFailed("down", code="provider_unavailable")
        return json.dumps(self._payload)

    async def aclose(self) -> None:
        return None


class RecordingDispatcher:
    """Stands in for the runtimes; records every dispatch it is asked for."""

    def __init__(self) -> None:
        self.dispatched: list[tuple[str, str]] = []

    async def __call__(self, agent: str, task_input: str) -> str:
        self.dispatched.append((agent, task_input))
        return f"{agent[:2]}-child-{len(self.dispatched)}"


@pytest.fixture
def checkpoint_path(tmp_path: Path) -> Path:
    return tmp_path / "checkpoints.sqlite"


async def test_an_unknown_agent_is_dropped_before_the_human_sees_the_plan(checkpoint_path: Path) -> None:
    gateway = FakeGateway(PLAN)
    dispatcher = RecordingDispatcher()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_governor_graph(gateway, dispatcher), checkpointer=saver, prefix="gv")  # type: ignore[arg-type]
        handle = await runtime.start_with({"objective": "raise checkups 10%"})

    assert handle.is_awaiting_approval
    payload = handle.interrupt_payload
    assert payload is not None
    assert payload["step_count"] == 2
    assert all(step["agent"] in {"analyst", "creative"} for step in payload["steps"])
    # Nothing is dispatched while the plan is only proposed.
    assert dispatcher.dispatched == []


async def test_approval_dispatches_each_step_exactly_once(checkpoint_path: Path) -> None:
    gateway = FakeGateway(PLAN)
    dispatcher = RecordingDispatcher()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_governor_graph(gateway, dispatcher), checkpointer=saver, prefix="gv")  # type: ignore[arg-type]
        await runtime.start_with({"objective": "raise checkups 10%"}, run_id="gv-1")
        handle = await runtime.resume("gv-1", decision="approved")
        # A second resume must not re-dispatch: nothing is pending, and the
        # execute node's idempotency key already records the work.
        again = await runtime.resume("gv-1", decision="approved")

    assert handle.status == "completed"
    assert dispatcher.dispatched == [
        ("analyst", "what blocks live sign-in?"),
        ("creative", "Diwali FHC push for young parents"),
    ]
    assert len(handle.state["children"]) == 2
    assert again.state["children"] == handle.state["children"]
    assert gateway.calls == 1


async def test_rejection_dispatches_nothing(checkpoint_path: Path) -> None:
    gateway = FakeGateway(PLAN)
    dispatcher = RecordingDispatcher()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_governor_graph(gateway, dispatcher), checkpointer=saver, prefix="gv")  # type: ignore[arg-type]
        await runtime.start_with({"objective": "x"}, run_id="gv-1")
        handle = await runtime.resume("gv-1", decision="rejected", reason="not now")

    assert handle.status == "rejected"
    assert dispatcher.dispatched == []


async def test_a_plan_with_no_valid_steps_fails_without_a_gate(checkpoint_path: Path) -> None:
    gateway = FakeGateway({"summary": "?", "steps": [{"agent": "astrologer", "input": "x", "rationale": ""}]})
    dispatcher = RecordingDispatcher()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_governor_graph(gateway, dispatcher), checkpointer=saver, prefix="gv")  # type: ignore[arg-type]
        handle = await runtime.start_with({"objective": "x"})

    assert handle.status == "failed"
    assert handle.state["error_code"] == "no_valid_steps"


async def test_a_fourth_step_is_dropped_at_the_cap(checkpoint_path: Path) -> None:
    steps = [
        {"agent": "analyst", "input": f"question {i}", "rationale": ""} for i in range(4)
    ]
    gateway = FakeGateway({"summary": "s", "steps": steps})
    dispatcher = RecordingDispatcher()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_governor_graph(gateway, dispatcher), checkpointer=saver, prefix="gv")  # type: ignore[arg-type]
        handle = await runtime.start_with({"objective": "x"})

    assert handle.interrupt_payload is not None
    assert handle.interrupt_payload["step_count"] == 3

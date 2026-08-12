"""The Analyst graph: interrupt, resume, and surviving a restart.

`test_a_run_survives_the_process_that_started_it` is the headline. It runs the
resume in a **genuinely separate Python process** — not a second runtime object
in the same interpreter — because that is the only way to prove the pause is
durable rather than merely held in memory. A `MemorySaver` would pass an
in-process test and fail this one, which is exactly the defect the audit found.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
from helm_worker.checkpoint import open_checkpointer
from helm_worker.gateway_client import GatewayCallFailed, GroundedAnswer
from helm_worker.runtime import AnalystRuntime

QUESTION = "what is blocking live sign-in?"

# Resolved once at import, outside any async function: `Path.resolve()` touches
# the filesystem, and the package root is fixed for the whole session anyway.
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


class FakeGateway:
    """Counts calls, so re-billing on resume is observable rather than assumed."""

    def __init__(self, *, answer: str = "Create the helm-api API in Auth0.", fails: bool = False) -> None:
        self.calls: list[str] = []
        self.idempotency_keys: list[str | None] = []
        self._answer = answer
        self._fails = fails

    async def ask(self, question: str, *, idempotency_key: str | None = None) -> GroundedAnswer:
        self.calls.append(question)
        self.idempotency_keys.append(idempotency_key)
        if self._fails:
            raise GatewayCallFailed("provider is down", code="provider_unavailable")
        return GroundedAnswer(
            answer=self._answer,
            citations=[{"doc": "docs/PENDING.md", "heading": "Blocking", "start_line": 3, "quote": "Create"}],
            grounded=True,
            corpus_digest="abc123",
            sections_supplied=8,
        )

    async def aclose(self) -> None:
        return None


@pytest.fixture
def checkpoint_path(tmp_path: Path) -> Path:
    return tmp_path / "checkpoints.sqlite"


async def test_a_run_pauses_for_approval_before_acting(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        handle = await runtime.start(QUESTION, run_id="run-1")

    assert handle.is_awaiting_approval
    assert handle.status == "awaiting_approval"
    assert handle.interrupt_payload is not None
    assert handle.interrupt_payload["action"] == "persist_findings"
    # Nothing was executed while the run is paused.
    assert handle.state.get("execution_log", []) == []


async def test_approving_executes_exactly_once(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")
        handle = await runtime.resume("run-1", decision="approved")

    assert handle.status == "completed"
    assert len(handle.state["execution_log"]) == 1
    assert len(gateway.calls) == 1


async def test_rejecting_discards_rather_than_persisting(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")
        handle = await runtime.resume("run-1", decision="rejected", reason="not useful")

    assert handle.status == "rejected"
    assert "discarded" in handle.state["execution_log"][0]
    assert "not useful" in handle.state["execution_log"][0]


async def test_resuming_twice_does_not_execute_twice(checkpoint_path: Path) -> None:
    """The idempotency guard, checked against recorded state.

    The mutation that turns this red is deleting the `executed_key` check from
    the `execute` node.
    """

    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")
        await runtime.resume("run-1", decision="approved")
        handle = await runtime.resume("run-1", decision="approved")

    assert len(handle.state["execution_log"]) == 1
    assert len(gateway.calls) == 1


async def test_resuming_a_run_that_is_not_paused_is_a_no_op(checkpoint_path: Path) -> None:
    """Re-entering a finished graph could re-run work that already completed."""

    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")
        await runtime.resume("run-1", decision="approved")
        before = len(gateway.calls)
        handle = await runtime.resume("run-1", decision="approved")

    assert len(gateway.calls) == before
    assert handle.status == "completed"


async def test_the_model_is_not_called_again_on_resume(checkpoint_path: Path) -> None:
    """Resume must not re-bill.

    LangGraph re-runs the interrupted node from its beginning, so a model call
    placed inside `await_approval` — or anywhere before the `interrupt()` in
    that node — would be charged again on every resume. The mutation that turns
    this red is moving the gateway call into `await_approval`.
    """

    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")
        assert len(gateway.calls) == 1
        handle = await runtime.resume("run-1", decision="approved")

    assert len(gateway.calls) == 1
    assert handle.state["model_calls"] == 1


async def test_the_analysis_call_is_keyed_for_idempotency(checkpoint_path: Path) -> None:
    """A re-entered analyze must reuse its budget hold, not take a second one."""

    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")

    assert gateway.idempotency_keys == ["run:run-1:analyze"]


async def test_a_failed_analysis_skips_the_human_gate(checkpoint_path: Path) -> None:
    """Nobody should be asked to approve an empty finding."""

    gateway = FakeGateway(fails=True)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        handle = await runtime.start(QUESTION, run_id="run-1")

    assert handle.is_awaiting_approval is False
    assert handle.status == "failed"
    assert handle.state["error_code"] == "provider_unavailable"


async def test_an_invalid_decision_is_refused(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-1")
        with pytest.raises(ValueError):
            await runtime.resume("run-1", decision="maybe")


async def test_two_runs_do_not_share_state(checkpoint_path: Path) -> None:
    """`thread_id` is the run id, so runs must be fully isolated."""

    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        await runtime.start(QUESTION, run_id="run-a")
        await runtime.start("a different question", run_id="run-b")
        await runtime.resume("run-a", decision="approved")

        a = await runtime.inspect("run-a")
        b = await runtime.inspect("run-b")

    assert a.status == "completed"
    assert b.status == "awaiting_approval"
    assert b.state.get("execution_log", []) == []


# --- The restart test ------------------------------------------------------

_RESUME_SCRIPT = textwrap.dedent(
    """
    import asyncio, json, sys
    from pathlib import Path
    from helm_worker.checkpoint import open_checkpointer
    from helm_worker.gateway_client import GroundedAnswer
    from helm_worker.runtime import AnalystRuntime

    class ExplodingGateway:
        '''Fails loudly if the resume calls a model.

        A resume that re-ran the analysis would be silently re-billing the
        tenant; making that an exception turns it into a visible failure.
        '''
        async def ask(self, question, *, idempotency_key=None):
            raise AssertionError("resume must not call the model again")
        async def aclose(self):
            return None

    async def main(path, run_id):
        async with open_checkpointer(Path(path)) as saver:
            runtime = AnalystRuntime(gateway=ExplodingGateway(), checkpointer=saver)
            before = await runtime.inspect(run_id)
            handle = await runtime.resume(run_id, decision="approved")
            print(json.dumps({
                "was_awaiting": before.is_awaiting_approval,
                "status": handle.status,
                "execution_log": handle.state.get("execution_log", []),
                "model_calls": handle.state.get("model_calls", 0),
                "answer": handle.state.get("answer", ""),
            }))

    asyncio.run(main(sys.argv[1], sys.argv[2]))
    """
)


async def test_a_run_survives_the_process_that_started_it(checkpoint_path: Path, tmp_path: Path) -> None:
    """Start a run here, approve it from a brand-new interpreter.

    This is the test that makes the durability claim real. The resuming process
    shares no memory with this one — it reconstructs the run entirely from the
    checkpoint file, and its gateway raises if anything tries to call a model.

    The mutation that turns this red is swapping `AsyncSqliteSaver` for
    `MemorySaver` in `checkpoint.py`: every in-process test above still passes,
    and this one fails immediately because the second process finds no run.
    """

    gateway = FakeGateway(answer="Register the helm-api API in the Auth0 tenant.")

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AnalystRuntime(gateway=gateway, checkpointer=saver)  # type: ignore[arg-type]
        started = await runtime.start(QUESTION, run_id="survivor")

    assert started.is_awaiting_approval
    assert len(gateway.calls) == 1

    script = tmp_path / "resume_in_new_process.py"
    script.write_text(_RESUME_SCRIPT, encoding="utf-8")

    package_root = PACKAGE_ROOT
    environment = dict(os.environ)
    # The child is a fresh interpreter with none of this process's import
    # state, so it needs the package root on its path explicitly.
    environment["PYTHONPATH"] = str(package_root)

    # Blocking on purpose. The whole point is a second, fully separate
    # interpreter running to completion while this one waits — an async
    # subprocess would only obscure that. ASYNC221 is suppressed knowingly.
    completed = subprocess.run(  # noqa: ASYNC221
        [sys.executable, str(script), str(checkpoint_path), "survivor"],
        capture_output=True,
        text=True,
        cwd=str(package_root),
        env=environment,
        timeout=180,
    )

    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout.strip().splitlines()[-1])

    # The new process found the run paused exactly where the first one left it.
    assert result["was_awaiting"] is True
    assert result["status"] == "completed"
    # It executed once, and never called the model.
    assert len(result["execution_log"]) == 1
    assert result["model_calls"] == 1
    # The answer crossed the process boundary intact.
    assert result["answer"] == "Register the helm-api API in the Auth0 tenant."

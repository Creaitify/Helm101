"""The Analyst graph's state.

A plain `TypedDict` so LangGraph can checkpoint it. Everything here is
serialisable — no clients, no open handles, nothing that cannot survive being
written to disk and read back in a different process. That constraint is the
whole reason a run can outlive the worker that started it.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, TypedDict

Decision = Literal["approved", "rejected"]


def _last_write_wins(_current: Any, incoming: Any) -> Any:
    """Reducer for fields a single node owns.

    Explicit rather than implied: each of these is written by exactly one node,
    so the newest write is always the right one.
    """

    return incoming


class AnalystState(TypedDict, total=False):
    """Everything a run needs to survive a restart."""

    # Inputs
    question: str
    run_id: str

    # Produced by `analyze`. The model call happens once; these carry its
    # result across the interrupt so resuming never re-asks.
    answer: Annotated[str, _last_write_wins]
    citations: Annotated[list[dict[str, Any]], _last_write_wins]
    grounded: Annotated[bool, _last_write_wins]
    corpus_digest: Annotated[str, _last_write_wins]
    model_calls: Annotated[int, _last_write_wins]

    # Produced by `propose`, before the interrupt.
    proposal: Annotated[dict[str, Any], _last_write_wins]

    # Supplied by the human, through `Command(resume=...)`.
    decision: Annotated[str, _last_write_wins]
    decision_reason: Annotated[str, _last_write_wins]

    # Produced by `execute`, after the interrupt. `executed_key` is the
    # idempotency guard: a re-entered node that sees its own key already
    # recorded does nothing a second time.
    executed_key: Annotated[str, _last_write_wins]
    execution_log: Annotated[list[str], _last_write_wins]

    status: Annotated[str, _last_write_wins]
    error_code: Annotated[str, _last_write_wins]

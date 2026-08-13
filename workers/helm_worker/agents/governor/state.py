"""The Governor graph's state. Same serialisability rules as the others."""

from __future__ import annotations

from typing import Annotated, Any, TypedDict


def _last_write_wins(_current: Any, incoming: Any) -> Any:
    return incoming


class GovernorState(TypedDict, total=False):
    """Everything a run needs to survive a restart."""

    # Inputs
    run_id: str
    objective: str

    # Produced by `plan` — the only model call.
    plan_summary: Annotated[str, _last_write_wins]
    raw_steps: Annotated[list[dict[str, Any]], _last_write_wins]
    model_calls: Annotated[int, _last_write_wins]

    # Produced by `validate` — pure code.
    steps: Annotated[list[dict[str, Any]], _last_write_wins]
    validation_notes: Annotated[list[str], _last_write_wins]

    # The human gate.
    proposal: Annotated[dict[str, Any], _last_write_wins]
    decision: Annotated[str, _last_write_wins]
    decision_reason: Annotated[str, _last_write_wins]
    executed_key: Annotated[str, _last_write_wins]
    execution_log: Annotated[list[str], _last_write_wins]

    # Produced by `execute`: the child runs actually dispatched. Each child
    # pauses at its own approval gate — the Governor never bypasses one.
    children: Annotated[list[dict[str, str]], _last_write_wins]

    status: Annotated[str, _last_write_wins]
    error_code: Annotated[str, _last_write_wins]

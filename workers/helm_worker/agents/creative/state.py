"""The Creative graph's state. Same serialisability rules as the others."""

from __future__ import annotations

from typing import Annotated, Any, TypedDict


def _last_write_wins(_current: Any, incoming: Any) -> Any:
    return incoming


class CreativeState(TypedDict, total=False):
    """Everything a run needs to survive a restart."""

    # Inputs
    run_id: str
    brief: str

    # Produced by `generate` — the only model call.
    variants: Annotated[list[dict[str, Any]], _last_write_wins]
    model_calls: Annotated[int, _last_write_wins]

    # Produced by `check_compliance` — pure code, never the model.
    verdicts: Annotated[list[dict[str, Any]], _last_write_wins]

    # The human gate.
    proposal: Annotated[dict[str, Any], _last_write_wins]
    decision: Annotated[str, _last_write_wins]
    decision_reason: Annotated[str, _last_write_wins]
    executed_key: Annotated[str, _last_write_wins]
    execution_log: Annotated[list[str], _last_write_wins]

    # Produced by `execute`: what actually shipped, and what never can.
    shipped: Annotated[list[dict[str, Any]], _last_write_wins]

    status: Annotated[str, _last_write_wins]
    error_code: Annotated[str, _last_write_wins]

"""The Media Buyer graph's state. Same rules as the Analyst's: a plain
TypedDict, everything serialisable, so a run survives its process."""

from __future__ import annotations

from typing import Annotated, Any, TypedDict


def _last_write_wins(_current: Any, incoming: Any) -> Any:
    return incoming


class MediaBuyerState(TypedDict, total=False):
    """Everything a run needs to survive a restart."""

    # Inputs
    run_id: str
    objective: str
    campaigns: Annotated[list[dict[str, Any]], _last_write_wins]
    data_label: Annotated[str, _last_write_wins]

    # Produced by `analyze` — the only model call.
    analysis: Annotated[str, _last_write_wins]
    raw_shifts: Annotated[list[dict[str, Any]], _last_write_wins]
    model_calls: Annotated[int, _last_write_wins]

    # Produced by `enforce_policy` — pure code, never the model.
    shifts: Annotated[list[dict[str, Any]], _last_write_wins]
    policy_notes: Annotated[list[str], _last_write_wins]

    # The human gate, identical in shape to the Analyst's.
    proposal: Annotated[dict[str, Any], _last_write_wins]
    decision: Annotated[str, _last_write_wins]
    decision_reason: Annotated[str, _last_write_wins]
    executed_key: Annotated[str, _last_write_wins]
    execution_log: Annotated[list[str], _last_write_wins]

    status: Annotated[str, _last_write_wins]
    error_code: Annotated[str, _last_write_wins]

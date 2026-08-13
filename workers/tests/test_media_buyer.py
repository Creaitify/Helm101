"""The Media Buyer: policy math in code, and the human gate around it.

The policy tests are the important ones — they are what makes "the model is
never the policy" true rather than asserted. Each names the violation it
stops.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from helm_worker.agents.media_buyer import build_media_buyer_graph
from helm_worker.agents.media_buyer.data import SAMPLE_CAMPAIGNS, SAMPLE_LABEL
from helm_worker.agents.media_buyer.policy import apply_policy
from helm_worker.checkpoint import open_checkpointer
from helm_worker.gateway_client import GatewayCallFailed
from helm_worker.runtime import AgentRuntime

CAMPAIGNS: list[dict[str, object]] = [
    {"id": "a", "name": "A", "daily_budget": 1_000},
    {"id": "b", "name": "B", "daily_budget": 2_000},
]


class FakeGateway:
    """Returns a canned completion; counts calls so re-billing is observable."""

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


class TestPolicy:
    def test_an_unknown_campaign_is_dropped_not_guessed(self) -> None:
        result = apply_policy(CAMPAIGNS, [{"campaign_id": "ghost", "proposed_budget": 500}])
        assert result.shifts == []
        assert any("unknown campaign" in note for note in result.notes)

    def test_a_non_numeric_budget_is_dropped(self) -> None:
        result = apply_policy(CAMPAIGNS, [{"campaign_id": "a", "proposed_budget": "lots"}])
        assert result.shifts == []

    def test_a_boolean_budget_is_dropped_not_coerced(self) -> None:
        # bool is an int subclass; True must not become a ₹1 budget.
        result = apply_policy(CAMPAIGNS, [{"campaign_id": "a", "proposed_budget": True}])
        assert result.shifts == []

    def test_a_duplicate_shift_keeps_the_first(self) -> None:
        result = apply_policy(
            CAMPAIGNS,
            [
                {"campaign_id": "a", "proposed_budget": 900},
                {"campaign_id": "a", "proposed_budget": 800},
            ],
        )
        assert len(result.shifts) == 1
        assert result.shifts[0]["proposed_budget"] == 900

    def test_a_move_beyond_25_percent_is_clamped(self) -> None:
        # The decrease on `b` funds the increase, so the clamp is what remains
        # visible; without it the no-new-money rule would trim the raise away.
        result = apply_policy(
            CAMPAIGNS,
            [
                {"campaign_id": "a", "proposed_budget": 5_000},
                {"campaign_id": "b", "proposed_budget": 1_500},
            ],
        )
        by_id = {s["campaign_id"]: s["proposed_budget"] for s in result.shifts}
        assert by_id["a"] == 1_250  # 1000 * 1.25
        assert any("clamped" in note for note in result.notes)

    def test_a_lone_increase_cannot_create_money(self) -> None:
        # With nothing freeing budget, an increase is trimmed back to its
        # current value and the resulting no-op is dropped.
        result = apply_policy(CAMPAIGNS, [{"campaign_id": "a", "proposed_budget": 1_250}])
        assert result.shifts == []
        assert any("trimmed" in note for note in result.notes)

    def test_the_proposal_cannot_create_money(self) -> None:
        # Both raised to their caps: total 3750 > current 3000. The larger
        # increase is trimmed until the totals balance.
        result = apply_policy(
            CAMPAIGNS,
            [
                {"campaign_id": "a", "proposed_budget": 1_250},
                {"campaign_id": "b", "proposed_budget": 2_500},
            ],
        )
        proposed_total = sum(s["proposed_budget"] for s in result.shifts)
        assert proposed_total <= 3_000
        assert any("trimmed" in note for note in result.notes)

    def test_a_pure_reallocation_survives_untouched(self) -> None:
        result = apply_policy(
            CAMPAIGNS,
            [
                {"campaign_id": "a", "proposed_budget": 1_250, "reason": "winner"},
                {"campaign_id": "b", "proposed_budget": 1_750, "reason": "loser"},
            ],
        )
        assert {s["campaign_id"]: s["proposed_budget"] for s in result.shifts} == {"a": 1_250, "b": 1_750}
        assert result.notes == []

    def test_a_no_op_shift_is_dropped(self) -> None:
        result = apply_policy(CAMPAIGNS, [{"campaign_id": "a", "proposed_budget": 1_000}])
        assert result.shifts == []
        assert any("no-op" in note for note in result.notes)


PROPOSAL = {
    "analysis": "Retargeting is cheapest; competitor search is bleeding.",
    "shifts": [
        {"campaign_id": "fhc-meta-retargeting", "proposed_budget": 50_000, "reason": "scale the winner"},
        {"campaign_id": "search-competitor", "proposed_budget": 22_500, "reason": "cut the loser"},
    ],
}


@pytest.fixture
def checkpoint_path(tmp_path: Path) -> Path:
    return tmp_path / "checkpoints.sqlite"


async def test_a_run_pauses_with_the_policy_checked_proposal(checkpoint_path: Path) -> None:
    gateway = FakeGateway(PROPOSAL)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_media_buyer_graph(gateway), checkpointer=saver, prefix="mb")  # type: ignore[arg-type]
        handle = await runtime.start_with(
            {"objective": "lower CAC", "campaigns": SAMPLE_CAMPAIGNS, "data_label": SAMPLE_LABEL}
        )

    assert handle.is_awaiting_approval
    assert handle.run_id.startswith("mb-")
    assert handle.interrupt_payload is not None
    assert handle.interrupt_payload["action"] == "apply_budget_shifts"
    assert handle.interrupt_payload["shift_count"] == 2
    assert handle.interrupt_payload["data_label"] == SAMPLE_LABEL


async def test_approving_records_the_shifts_exactly_once(checkpoint_path: Path) -> None:
    gateway = FakeGateway(PROPOSAL)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_media_buyer_graph(gateway), checkpointer=saver, prefix="mb")  # type: ignore[arg-type]
        started = await runtime.start_with(
            {"objective": "lower CAC", "campaigns": SAMPLE_CAMPAIGNS, "data_label": SAMPLE_LABEL},
            run_id="mb-1",
        )
        assert started.is_awaiting_approval
        handle = await runtime.resume("mb-1", decision="approved")

    assert handle.status == "completed"
    assert len(handle.state["execution_log"]) == 1
    assert "proposal only" in handle.state["execution_log"][0]
    assert gateway.calls == 1


async def test_a_model_that_proposes_nothing_valid_skips_the_human_gate(checkpoint_path: Path) -> None:
    gateway = FakeGateway({"analysis": "x", "shifts": [{"campaign_id": "ghost", "proposed_budget": 1}]})

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_media_buyer_graph(gateway), checkpointer=saver, prefix="mb")  # type: ignore[arg-type]
        handle = await runtime.start_with({"campaigns": SAMPLE_CAMPAIGNS})

    assert not handle.is_awaiting_approval
    assert handle.status == "failed"
    assert handle.state["error_code"] == "no_valid_shifts"


async def test_a_gateway_failure_fails_cleanly(checkpoint_path: Path) -> None:
    gateway = FakeGateway(fails=True)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_media_buyer_graph(gateway), checkpointer=saver, prefix="mb")  # type: ignore[arg-type]
        handle = await runtime.start_with({"campaigns": SAMPLE_CAMPAIGNS})

    assert handle.status == "failed"
    assert handle.state["error_code"] == "provider_unavailable"

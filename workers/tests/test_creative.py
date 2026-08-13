"""The Creative: deterministic compliance rules, and the block that approval
cannot override."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from helm_worker.agents.creative import build_creative_graph
from helm_worker.agents.creative.compliance import check
from helm_worker.checkpoint import open_checkpointer
from helm_worker.gateway_client import GatewayCallFailed
from helm_worker.runtime import AgentRuntime


class TestComplianceRules:
    def test_an_assured_returns_claim_is_blocked(self) -> None:
        verdict = check("Invest now for Assured Returns of 12%")
        assert verdict.status == "block"
        assert "assured return" in verdict.matched

    def test_a_risk_free_claim_is_blocked_case_insensitively(self) -> None:
        assert check("A RISK-FREE way to grow").status == "block"

    def test_guaranteed_alone_flags_rather_than_blocks(self) -> None:
        verdict = check("Guaranteed same-day report delivery")
        assert verdict.status == "flag"
        assert "guaranteed" in verdict.matched

    def test_clean_copy_passes(self) -> None:
        assert check("Book your ₹999 Financial Health Checkup today").status == "pass"

    def test_a_block_wins_over_a_flag_when_both_match(self) -> None:
        assert check("Guaranteed returns, guaranteed!").status == "block"

    def test_the_verdict_names_its_rules_version(self) -> None:
        assert check("anything").rules_version


VARIANTS = {
    "variants": [
        {"headline": "Know your money in 30 minutes", "body": "The ₹999 Financial Health Checkup."},
        {"headline": "Guaranteed clarity", "body": "A full report on your finances."},
        {"headline": "Risk-free wealth doubling", "body": "Assured returns for every investor."},
    ]
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


@pytest.fixture
def checkpoint_path(tmp_path: Path) -> Path:
    return tmp_path / "checkpoints.sqlite"


async def test_the_proposal_reports_the_verdict_split(checkpoint_path: Path) -> None:
    gateway = FakeGateway(VARIANTS)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_creative_graph(gateway), checkpointer=saver, prefix="cr")  # type: ignore[arg-type]
        handle = await runtime.start_with({"brief": "Diwali FHC push"})

    assert handle.is_awaiting_approval
    payload = handle.interrupt_payload
    assert payload is not None
    assert payload["passed"] == 1
    assert payload["flagged"] == 1
    assert payload["blocked"] == 1


async def test_approval_ships_pass_and_flag_but_never_a_blocked_variant(checkpoint_path: Path) -> None:
    """The structural rule: a hard block is not overridable by approval."""

    gateway = FakeGateway(VARIANTS)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_creative_graph(gateway), checkpointer=saver, prefix="cr")  # type: ignore[arg-type]
        await runtime.start_with({"brief": "Diwali FHC push"}, run_id="cr-1")
        handle = await runtime.resume("cr-1", decision="approved")

    assert handle.status == "completed"
    shipped = handle.state["shipped"]
    assert len(shipped) == 2
    assert all("Risk-free" not in v["headline"] for v in shipped)
    # The flag rides on the shipped record rather than disappearing.
    assert {v["compliance"] for v in shipped} == {"pass", "flag"}
    assert gateway.calls == 1


async def test_rejection_ships_nothing(checkpoint_path: Path) -> None:
    gateway = FakeGateway(VARIANTS)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_creative_graph(gateway), checkpointer=saver, prefix="cr")  # type: ignore[arg-type]
        await runtime.start_with({"brief": "x"}, run_id="cr-1")
        handle = await runtime.resume("cr-1", decision="rejected", reason="off brand")

    assert handle.status == "rejected"
    assert handle.state.get("shipped", []) == []


async def test_an_empty_generation_fails_without_a_gate(checkpoint_path: Path) -> None:
    gateway = FakeGateway({"variants": []})

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(graph=build_creative_graph(gateway), checkpointer=saver, prefix="cr")  # type: ignore[arg-type]
        handle = await runtime.start_with({"brief": "x"})

    assert handle.status == "failed"
    assert handle.state["error_code"] == "no_variants"

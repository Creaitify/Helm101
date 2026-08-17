"""The Governor Star Topology Relay: tested end-to-end.

Verifies:
1. Star topology execution: Analyst ↔ Governor ↔ Creative ↔ Governor ↔ Media Buyer ↔ Governor ↔ HITL.
2. Every hop produces a valid HandoffEnvelope with typed payload.
3. Pause at HITL gate and durable resume across checkpointer.
4. Loopback handling on SEBI compliance blocks.
5. Rejection recording.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from helm_worker.agents.governor import build_governor_graph
from helm_worker.checkpoint import open_checkpointer
from helm_worker.gateway_client import GatewayCallFailed
from helm_worker.runtime import AgentRuntime


class FakeGateway:
    def __init__(self, *, blocked_creative: bool = False, flagged_creative: bool = False, fails: bool = False) -> None:
        self.calls = 0
        self.schemas: dict[str, Any] = {}
        self._blocked_creative = blocked_creative
        self._flagged_creative = flagged_creative
        self._fails = fails

    async def ask(self, question: str, *, idempotency_key: str | None = None) -> Any:
        self.calls += 1
        if self._fails:
            raise GatewayCallFailed("down", code="provider_unavailable")

        class FakeAnswer:
            answer = "Recent 30D analysis shows 4.2x ROAS on Retargeting and elevated CAC on non-brand search.\n• Blended CAC: ₹341\n• Fatigue signal: Search competitor fatigue\n• Angle recommendation: Transparent fee-only portfolio planning"
            citations = [{"label": "Audience Segments", "source": "docs/finnovate.md"}]
            grounded = True
            corpus_digest = "sha256:test"
            citations_rejected = 0

        return FakeAnswer()

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
        if json_schema is not None:
            self.schemas[task] = json_schema
        if self._fails:
            raise GatewayCallFailed("down", code="provider_unavailable")

        if task == "governor.plan":
            return json.dumps(
                {
                    "plan_summary": "Orchestrated growth strategy for ₹999 checkup",
                    "directives": {
                        "analyst": "Audit 30D CAC and audience dispersion",
                        "creative": "Draft SEBI-compliant copy variants",
                        "media_buyer": "Rebalance budgets under ±25% caps",
                    },
                }
            )

        if task == "creative.variants":
            if self._blocked_creative:
                return json.dumps(
                    {
                        "variants": [
                            {"headline": "Guaranteed 100% Returns", "body": "Risk-free assured profit on investments."},
                            {"headline": "Zero Risk Double Profit", "body": "Guaranteed growth with 100% certainty."},
                        ]
                    }
                )
            if self._flagged_creative:
                return json.dumps(
                    {
                        "variants": [
                            {"headline": "Safe Investment Planning", "body": "Get best returns with our portfolio review for ₹999."},
                            {"headline": "Complete Financial Health Checkup", "body": "Get a comprehensive portfolio review and unbiased roadmap today for ₹999."},
                        ]
                    }
                )
            return json.dumps(
                {
                    "variants": [
                        {"headline": "Complete Financial Health Checkup", "body": "Get a comprehensive portfolio review and unbiased roadmap today for ₹999."},
                        {"headline": "Transparent Financial Assessment", "body": "Understand your wealth, investments, and tax profile with SEBI-registered advisors."},
                        {"headline": "Take Control of Your Wealth", "body": "Clear, objective financial assessment designed to protect and grow your family assets."},
                    ]
                }
            )

        if task == "media_buyer.proposal":
            return json.dumps(
                {
                    "analysis": "Shift spend towards high-converting Meta retargeting.",
                    "shifts": [
                        {"campaign_id": "fhc-meta-retargeting", "proposed_budget": 50000, "reason": "High conversion velocity"},
                        {"campaign_id": "search-competitor", "proposed_budget": 20000, "reason": "Shift funds to top performer"},
                    ],
                }
            )

        return "{}"

    async def aclose(self) -> None:
        return None


@pytest.fixture
def checkpoint_path(tmp_path: Path) -> Path:
    return tmp_path / "checkpoints.sqlite"


async def test_governor_star_relay_flows_through_analyst_creative_media_buyer_to_hitl(
    checkpoint_path: Path,
) -> None:
    gateway = FakeGateway()
    recorded_steps: list[dict] = []

    async def step_recorder(env: dict) -> None:
        recorded_steps.append(env)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway, step_recorder=step_recorder),
            checkpointer=saver,
            prefix="gv",
        )
        handle = await runtime.start_with(
            {"objective": "Optimize blended CAC for ₹999 checkup", "tenant_id": "letstute"},
            run_id="gv-relay-1",
        )

    # Must pause at HITL approval gate
    assert handle.is_awaiting_approval
    assert handle.status == "awaiting_approval"
    payload = handle.interrupt_payload
    assert payload is not None
    assert payload["action"] == "execute_governor_relay"
    assert len(payload["shifts"]) == 2
    assert len(payload["variants"]) == 3

    # Check hops
    hops = handle.state["hops"]
    assert len(hops) >= 6

    # Verify chronological sequence of mediated envelopes
    from_to_pairs = [(h["from_agent"], h["to_agent"]) for h in hops]
    assert ("analyst", "governor") in from_to_pairs
    assert ("governor", "creative") in from_to_pairs
    assert ("creative", "governor") in from_to_pairs
    assert ("governor", "media_buyer") in from_to_pairs
    assert ("media_buyer", "governor") in from_to_pairs
    assert ("governor", "hitl") in from_to_pairs

    # Verify no direct specialist to specialist hops exist
    for h in hops:
        assert not (h["from_agent"] == "analyst" and h["to_agent"] == "creative")
        assert not (h["from_agent"] == "creative" and h["to_agent"] == "media_buyer")


async def test_governor_approval_resumes_across_checkpoint(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway), checkpointer=saver, prefix="gv"
        )
        await runtime.start_with(
            {"objective": "Growth push", "tenant_id": "letstute"},
            run_id="gv-resume-test",
        )

        # Resume in a second call
        handle = await runtime.resume("gv-resume-test", decision="approved")

    assert handle.status == "completed"
    assert any("Approved deployment" in entry for entry in handle.state["execution_log"])
    assert any("Applied 2 daily budget shifts" in entry for entry in handle.state["execution_log"])


async def test_governor_rejection_discards_plan(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway), checkpointer=saver, prefix="gv"
        )
        await runtime.start_with(
            {"objective": "Scale campaigns", "tenant_id": "letstute"},
            run_id="gv-reject-test",
        )
        handle = await runtime.resume("gv-reject-test", decision="rejected", reason="Budget freeze")

    assert handle.status == "rejected"
    assert any("Budget freeze" in entry for entry in handle.state["execution_log"])


async def test_governor_loopback_recovers_from_temporary_sebi_block(checkpoint_path: Path) -> None:
    class LoopbackGateway(FakeGateway):
        def __init__(self) -> None:
            super().__init__()
            self.creative_calls = 0

        async def complete(self, task: str, messages: list[dict[str, str]], **kwargs: Any) -> str:
            if task == "creative.variants":
                self.creative_calls += 1
                if self.creative_calls == 1:
                    # First attempt: all variants violate SEBI rules
                    return json.dumps(
                        {
                            "variants": [
                                {"headline": "Guaranteed 100% Return", "body": "Risk-free assured profit on investments."},
                                {"headline": "Zero Risk Double Profit", "body": "Guaranteed growth with 100% certainty."},
                            ]
                        }
                    )
                # Second attempt after loopback: compliant
                return json.dumps(
                    {
                        "variants": [
                            {"headline": "Complete Financial Health Checkup", "body": "Unbiased portfolio review for ₹999."},
                            {"headline": "Transparent Financial Assessment", "body": "SEBI-registered fee-only advisory."},
                        ]
                    }
                )
            return await super().complete(task, messages, **kwargs)

    gateway = LoopbackGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway), checkpointer=saver, prefix="gv"
        )
        handle = await runtime.start_with(
            {"objective": "Lower CAC for ₹999 checkup", "tenant_id": "letstute"},
            run_id="gv-loopback-test",
        )

    assert handle.is_awaiting_approval
    assert handle.state["loopback_count"] == 1
    # Verify loopback hop exists in history
    verdicts = [h.get("verdict") for h in handle.state["hops"]]
    assert "loopback" in verdicts


async def test_governor_halts_when_sebi_retries_exhausted(checkpoint_path: Path) -> None:
    gateway = FakeGateway(blocked_creative=True)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway), checkpointer=saver, prefix="gv"
        )
        handle = await runtime.start_with(
            {"objective": "Aggressive scaling", "tenant_id": "letstute"},
            run_id="gv-exhausted-test",
        )

    assert handle.status == "failed"
    assert handle.state.get("error_code") == "sebi_compliance_exhausted"
    assert not handle.is_awaiting_approval


async def test_governor_supplies_json_schemas_for_all_specialist_completions(checkpoint_path: Path) -> None:
    gateway = FakeGateway()

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway), checkpointer=saver, prefix="gv"
        )
        handle = await runtime.start_with(
            {"objective": "Scale ₹999 checkups with fee-only transparency", "tenant_id": "letstute"},
            run_id="gv-schemas-test",
        )

    assert handle.is_awaiting_approval
    # Verify JSON schemas were supplied to gateway.complete calls
    assert "governor.plan" in gateway.schemas
    assert "creative.variants" in gateway.schemas
    assert "media_buyer.proposal" in gateway.schemas

    # Verify schema structures
    assert gateway.schemas["governor.plan"]["required"] == ["plan_summary", "directives"]
    assert gateway.schemas["creative.variants"]["required"] == ["variants"]
    assert gateway.schemas["media_buyer.proposal"]["required"] == ["shifts"]

    # Verify dynamic Analyst findings extraction
    analyst_findings = handle.state.get("analyst_findings", {})
    assert len(analyst_findings.get("trends", [])) > 0
    assert len(analyst_findings.get("top_angles", [])) > 0
    assert len(analyst_findings.get("decay_signals", [])) > 0


async def test_governor_reflects_actual_hitl_check_statuses_when_flagged(checkpoint_path: Path) -> None:
    gateway = FakeGateway(flagged_creative=True)

    async with open_checkpointer(checkpoint_path) as saver:
        runtime = AgentRuntime(
            graph=build_governor_graph(gateway), checkpointer=saver, prefix="gv"
        )
        handle = await runtime.start_with(
            {"objective": "Scale checkups", "tenant_id": "letstute"},
            run_id="gv-flagged-check-test",
        )

    assert handle.is_awaiting_approval
    proposal = handle.interrupt_payload
    assert proposal is not None
    checks = {c["label"]: c["status"] for c in proposal.get("checks", [])}
    
    # SEBI check should evaluate to "flagged" due to superlative phrase in variant
    assert checks.get("SEBI Compliance Rulebook") == "flagged"
    assert checks.get("±25% Budget Cap") == "pass"
    assert checks.get("Budget Conservation") == "pass"
    assert checks.get("Grounded Citation Guard") == "pass"
    assert proposal.get("validation_corrections", 0) > 0



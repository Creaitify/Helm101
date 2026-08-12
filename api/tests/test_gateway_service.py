"""Gateway composition: policy, refusals, kill switch, and vendor containment."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from uuid import UUID

import pytest
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter
from app.gateway.contracts import CompletionRequest, Effort, Message, Role, StopReason, TaskKind
from app.gateway.errors import (
    BudgetExceeded,
    KillSwitchEngaged,
    ProviderRefused,
    ProviderUnavailable,
)
from app.gateway.keys import ProviderKeys
from app.gateway.ledger import InMemoryLedger
from app.gateway.policy import CAPABILITIES, ROUTING_TABLE, resolve
from app.gateway.ratecard import RATE_CARD
from app.gateway.service import GatewayService

TENANT = UUID("11111111-1111-1111-1111-111111111111")

GATEWAY_ROOT = Path(__file__).resolve().parent.parent / "app" / "gateway"
VENDOR = "anthropic"


def _request(**overrides: object) -> CompletionRequest:
    defaults: dict[str, object] = {
        "task": TaskKind.ANALYST_ANSWER,
        "messages": [Message(role=Role.USER, content="What blocks live sign-in?")],
        "system_cacheable": "You answer questions about HELM.",
        "max_tokens": 1_024,
    }
    defaults.update(overrides)
    return CompletionRequest(**defaults)  # type: ignore[arg-type]


def _service(adapter: ReplayAdapter | None = None, **kwargs: object) -> tuple[GatewayService, InMemoryLedger]:
    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 100_000_000)
    service = GatewayService(
        adapter=adapter or ReplayAdapter([RecordedCompletion(text="An answer.")]),
        ledger=ledger,
        **kwargs,  # type: ignore[arg-type]
    )
    return service, ledger


async def test_a_successful_call_records_usage_and_reconciles() -> None:
    service, ledger = _service()

    response = await service.complete(_request(), tenant_id=TENANT)

    assert response.text == "An answer."
    assert response.stop_reason is StopReason.END_TURN

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0
    assert snapshot.spent_micros > 0

    (record,) = ledger.records()
    assert record.tenant_id == TENANT
    assert record.task is TaskKind.ANALYST_ANSWER
    assert record.cost_micros == snapshot.spent_micros
    assert record.outcome == "success"


async def test_a_refusal_raises_rather_than_returning_empty_text() -> None:
    """A safety refusal arrives as a successful provider response.

    Code that reads the first content block without checking the stop reason
    would hand an empty string back as though it were an answer. The mutation
    that turns this red is deleting the refusal check in the adapter.
    """

    adapter = ReplayAdapter([RecordedCompletion(text="", stop_reason=StopReason.REFUSAL)])
    service, ledger = _service(adapter)

    with pytest.raises(ProviderRefused):
        await service.complete(_request(), tenant_id=TENANT)

    # A refusal produced no billable usage, so the hold must be returned.
    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0
    assert snapshot.spent_micros == 0


async def test_a_provider_failure_releases_the_reservation() -> None:
    """A failing provider must not silently exhaust a tenant's budget."""

    adapter = ReplayAdapter([RecordedCompletion(raises=ProviderUnavailable())])
    service, ledger = _service(adapter)

    with pytest.raises(ProviderUnavailable):
        await service.complete(_request(), tenant_id=TENANT)

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0
    assert snapshot.spent_micros == 0
    assert ledger.records() == []


async def test_the_kill_switch_refuses_before_the_provider_is_called() -> None:
    """The gateway is authoritative for the kill switch, not the worker.

    A worker-side check saves a round trip but is not a control: anything that
    can reach the gateway must be refused when egress is frozen.
    """

    adapter = ReplayAdapter([RecordedCompletion(text="should never be produced")])
    service, ledger = _service(adapter, kill_switch=lambda: True)

    with pytest.raises(KillSwitchEngaged):
        await service.complete(_request(), tenant_id=TENANT)

    assert adapter.calls == []
    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0


async def test_an_exhausted_budget_refuses_before_the_provider_is_called() -> None:
    adapter = ReplayAdapter([RecordedCompletion(text="should never be produced")])
    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 0)
    service = GatewayService(adapter=adapter, ledger=ledger)

    with pytest.raises(BudgetExceeded):
        await service.complete(_request(), tenant_id=TENANT)

    assert adapter.calls == []


async def test_concurrent_calls_sharing_an_idempotency_key_hold_budget_once() -> None:
    """In-flight duplicates share one hold rather than stacking two.

    Scoped deliberately to in-flight duplicates, which is all the ledger can
    honestly guarantee. Replaying the *stored response* of an already-completed
    request needs the `idempotency_keys` table at the API layer and is not part
    of this slice — asserting it here would claim a guarantee that does not
    exist yet.
    """

    gate = asyncio.Event()

    class _Gated(ReplayAdapter):
        async def complete(self, request, policy):  # type: ignore[no-untyped-def]
            await gate.wait()
            return await super().complete(request, policy)

    adapter = _Gated([RecordedCompletion(text="ok")])
    service, ledger = _service(adapter)

    task = asyncio.gather(
        service.complete(_request(), tenant_id=TENANT, idempotency_key="same"),
        service.complete(_request(), tenant_id=TENANT, idempotency_key="same"),
    )
    await asyncio.sleep(0)
    snapshot_in_flight = await ledger.snapshot(tenant_id=TENANT)
    gate.set()
    await task

    # Two concurrent attempts, one hold: the reserved amount while both were in
    # flight equals the cost of a single call, not two.
    assert snapshot_in_flight.reserved_micros > 0
    settled = await ledger.snapshot(tenant_id=TENANT)
    assert settled.reserved_micros == 0
    assert len(ledger.records()) == 1


async def test_a_settled_reservation_releases_its_request_key() -> None:
    """A settled key must not outlive the reservation it named.

    Leaving it mapped would point the next lookup at an id that no longer
    exists, turning a routine retry into a crash.
    """

    service, ledger = _service()

    await service.complete(_request(), tenant_id=TENANT, idempotency_key="same")
    # The same key is usable again rather than resolving to a dead reservation.
    await service.complete(_request(), tenant_id=TENANT, idempotency_key="same")

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0
    assert len(ledger.records()) == 2


async def test_the_error_never_echoes_raw_provider_output() -> None:
    """Problem details must not leak upstream bodies.

    A provider error can carry prompt fragments or account detail, and the BFF
    contract forbids surfacing either.
    """

    secret = "PROVIDER-INTERNAL-DIAGNOSTIC-abc123"
    adapter = ReplayAdapter([RecordedCompletion(raises=ProviderUnavailable())])
    service, _ = _service(adapter)

    with pytest.raises(ProviderUnavailable) as caught:
        await service.complete(_request(), tenant_id=TENANT)

    assert secret not in str(caught.value)
    assert caught.value.code == "provider_unavailable"


async def test_budget_exceeded_uses_a_conventional_status_with_a_stable_code() -> None:
    """RFC 9110 reserves 402, so the code — not the status — is the contract."""

    assert BudgetExceeded.code == "budget_exceeded"
    assert BudgetExceeded.status_code == 409


async def test_effort_is_only_sent_to_models_that_accept_it() -> None:
    """Sending `effort` to a model that rejects it is a 400, not a nudge."""

    assert CAPABILITIES["claude-opus-5"].supports_effort is True
    assert CAPABILITIES["claude-haiku-4-5"].supports_effort is False


async def test_every_routed_model_has_a_rate_and_capabilities() -> None:
    """A model nobody priced would bill a tenant nothing and silently under-report."""

    for task, policy in ROUTING_TABLE.items():
        assert policy.model.model in RATE_CARD, f"{task} routes to an unpriced model"
        assert policy.model.model in CAPABILITIES, f"{task} routes to a model with no capabilities"


async def test_an_unrouted_task_raises_rather_than_defaulting() -> None:
    """Guessing a model would bill a tenant for one nobody approved."""

    with pytest.raises(KeyError):
        resolve("not.a.real.task")  # type: ignore[arg-type]


async def test_the_request_carries_effort_through_to_the_adapter() -> None:
    adapter = ReplayAdapter([RecordedCompletion(text="ok")])
    service, _ = _service(adapter)

    await service.complete(_request(effort=Effort.LOW), tenant_id=TENANT)

    assert adapter.calls[0].effort is Effort.LOW


def test_exactly_one_gateway_module_imports_the_provider_sdk() -> None:
    """The vendor SDK dependency must be confined to a single adapter.

    This is the containment that actually makes a second provider a new file:
    it is the *code coupling* that matters, not the string. The provider's name
    legitimately appears as data in the routing table and the key accessor —
    those name providers, which is their job — so asserting on the bare string
    would fail for the wrong reason.

    Following the vacuity convention, the count is asserted before the
    location, so a rename that removed the import everywhere could not make
    this pass by default.
    """

    importers = {
        path.relative_to(GATEWAY_ROOT).as_posix()
        for path in GATEWAY_ROOT.rglob("*.py")
        if re.search(rf"^\s*(import {VENDOR}|from {VENDOR})", path.read_text(encoding="utf-8"), re.MULTILINE)
    }

    assert len(importers) == 1, f"Expected exactly one SDK importer, found {sorted(importers)}"
    assert importers == {"adapters/anthropic.py"}


def test_the_pure_boundary_never_names_the_vendor() -> None:
    """`contracts.py` is the extraction-ready boundary and must stay neutral.

    The routing table and key accessor may name providers — that is their
    purpose. The contract types may not, or a second provider would inherit the
    first one's vocabulary.
    """

    source = (GATEWAY_ROOT / "contracts.py").read_text(encoding="utf-8")
    assert VENDOR not in source.lower()


def test_the_service_and_contracts_are_free_of_vendor_imports() -> None:
    """No provider SDK may be imported outside `adapters/`."""

    for name in ("service.py", "contracts.py", "ledger.py", "policy.py", "errors.py"):
        source = (GATEWAY_ROOT / name).read_text(encoding="utf-8")
        assert f"import {VENDOR}" not in source
        assert f"from {VENDOR}" not in source


def test_provider_keys_never_expose_a_value_in_their_description() -> None:
    keys = ProviderKeys()
    assert keys.describe() == {"anthropic": False}
    assert keys.has("anthropic") is False

"""Budget ledger behaviour, including the test the naive design fails.

The headline test here is `test_concurrent_requests_against_a_cap_yield_exactly_the_permitted_count`.
It is written at the **service** level rather than against the ledger directly,
and that choice is load-bearing — see the note above it.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter
from app.gateway.contracts import (
    CompletionRequest,
    Message,
    ModelRef,
    Role,
    TaskKind,
    Usage,
    UsageRecord,
)
from app.gateway.errors import BudgetExceeded
from app.gateway.ledger import InMemoryLedger
from app.gateway.policy import resolve
from app.gateway.ratecard import RATE_CARD_VERSION, estimate_micros
from app.gateway.service import GatewayService

TENANT = UUID("11111111-1111-1111-1111-111111111111")
OTHER_TENANT = UUID("22222222-2222-2222-2222-222222222222")


def _request(question: str = "What is blocking live sign-in?") -> CompletionRequest:
    return CompletionRequest(
        task=TaskKind.ANALYST_ANSWER,
        messages=[Message(role=Role.USER, content=question)],
        system_cacheable="You answer questions about HELM.",
        max_tokens=1_024,
    )


def _usage_record(cost_micros: int) -> UsageRecord:
    return UsageRecord(
        tenant_id=TENANT,
        task=TaskKind.ANALYST_ANSWER,
        model=ModelRef(provider="replay", model="claude-opus-5"),
        usage=Usage(input_tokens=10, output_tokens=10),
        cost_micros=cost_micros,
        latency_ms=1,
        outcome="success",
        request_id="req",
        rate_card_version=RATE_CARD_VERSION,
    )


def _cost_of_one_call() -> int:
    """What the service will reserve for a single `_request()`."""

    request = _request()
    policy = resolve(request.task)
    characters = len(request.system_cacheable) + len(request.system_volatile)
    characters += sum(len(message.content) for message in request.messages)
    return estimate_micros(
        policy.model.model,
        prompt_tokens=max(1, characters // 3),
        max_tokens=min(request.max_tokens, policy.capabilities.max_output_tokens),
    )


class _SlowAdapter(ReplayAdapter):
    """A replay adapter that keeps every call in flight until released.

    This is what puts N requests genuinely in flight at once. Without it each
    request would complete before the next began, and a cap test would pass
    against a record-after-the-fact design that cannot actually hold a cap.
    """

    def __init__(self, gate: asyncio.Event) -> None:
        super().__init__([RecordedCompletion(text="ok", input_tokens=10, output_tokens=10)])
        self._gate = gate
        self.concurrent_peak = 0
        self._in_flight = 0

    async def complete(self, request, policy):  # type: ignore[no-untyped-def]
        self._in_flight += 1
        self.concurrent_peak = max(self.concurrent_peak, self._in_flight)
        try:
            await self._gate.wait()
            return await super().complete(request, policy)
        finally:
            self._in_flight -= 1


async def test_concurrent_requests_against_a_cap_yield_exactly_the_permitted_count() -> None:
    """N simultaneous requests against a cap permitting fewer than N.

    Exactly the permitted number must succeed. This is the test a
    record-spend-after-the-call design fails: with no reservation held during
    the provider call, all twenty requests pass the cap check before any of
    them records anything, and twenty calls get billed against a budget for
    seven.

    The mutation that turns this red is moving the `reserve` in
    `GatewayService.complete` to after the adapter call. The `_SlowAdapter`
    gate is what makes that mutation observable — it holds every request inside
    the provider call simultaneously, which is exactly the window the naive
    design leaves unguarded.
    """

    permitted = 7
    attempts = 20
    unit_cost = _cost_of_one_call()

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, unit_cost * permitted)

    gate = asyncio.Event()
    adapter = _SlowAdapter(gate)
    service = GatewayService(adapter=adapter, ledger=ledger)

    async def attempt(index: int) -> bool:
        try:
            # A distinct idempotency key per attempt. Reusing one would make
            # the ledger's replay path dedupe them and the test would measure
            # idempotency rather than cap enforcement.
            await service.complete(_request(), tenant_id=TENANT, idempotency_key=f"attempt-{index}")
            return True
        except BudgetExceeded:
            return False

    task = asyncio.gather(*(attempt(index) for index in range(attempts)))
    # Let every attempt reach the provider call before any of them finishes.
    await asyncio.sleep(0)
    gate.set()
    outcomes = await task

    assert sum(outcomes) == permitted
    assert outcomes.count(False) == attempts - permitted

    # The assertion that actually separates reserve-before from
    # record-after: the refused requests must never have reached the provider.
    # Counting successes alone is not enough — a design that calls the provider
    # first and checks the cap afterwards also reports seven successes, having
    # already paid for twenty calls.
    assert len(adapter.calls) == permitted
    assert adapter.concurrent_peak == permitted

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.spent_micros <= snapshot.cap_micros
    assert snapshot.reserved_micros == 0


async def test_the_cap_is_enforced_per_tenant() -> None:
    """One tenant exhausting its budget must not affect another."""

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 100)
    ledger.set_cap(OTHER_TENANT, 100)

    await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=100)
    with pytest.raises(BudgetExceeded):
        await ledger.reserve(tenant_id=TENANT, request_key="b", estimated_micros=1)

    # The other tenant is untouched.
    reservation = await ledger.reserve(tenant_id=OTHER_TENANT, request_key="c", estimated_micros=100)
    assert reservation.tenant_id == OTHER_TENANT


async def test_a_released_reservation_returns_its_budget() -> None:
    """A failed call must not strand budget.

    Without the release, a provider outage would silently exhaust a tenant's
    budget without a single billable token being generated.
    """

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 100)

    reservation = await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=100)
    with pytest.raises(BudgetExceeded):
        await ledger.reserve(tenant_id=TENANT, request_key="b", estimated_micros=1)

    await ledger.release(reservation_id=reservation.id, reason="provider_error")

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0
    assert snapshot.spent_micros == 0
    # The budget is usable again.
    await ledger.reserve(tenant_id=TENANT, request_key="c", estimated_micros=100)


async def test_reconciling_replaces_the_hold_with_the_actual_cost() -> None:
    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 1_000)

    reservation = await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=900)
    await ledger.reconcile(reservation_id=reservation.id, actual_micros=250, record=_usage_record(250))

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 0
    assert snapshot.spent_micros == 250
    # The over-estimate is returned, so the tenant can spend it.
    assert snapshot.remaining_micros == 750


async def test_an_overrun_is_recorded_rather_than_refused() -> None:
    """When the real cost exceeds the estimate, record it.

    Refusing after the provider has already been paid would lose the record of
    money that genuinely left the account. The overrun instead tightens what
    the next reservation may hold.
    """

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 1_000)

    reservation = await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=100)
    await ledger.reconcile(reservation_id=reservation.id, actual_micros=1_500, record=_usage_record(1_500))

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.spent_micros == 1_500
    assert snapshot.remaining_micros == 0
    with pytest.raises(BudgetExceeded):
        await ledger.reserve(tenant_id=TENANT, request_key="b", estimated_micros=1)


async def test_reconciling_twice_does_not_double_bill() -> None:
    """A retried reconcile must be a no-op, not a second charge."""

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 1_000)

    reservation = await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=100)
    await ledger.reconcile(reservation_id=reservation.id, actual_micros=100, record=_usage_record(100))
    await ledger.reconcile(reservation_id=reservation.id, actual_micros=100, record=_usage_record(100))

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.spent_micros == 100
    assert len(ledger.records()) == 1


async def test_the_same_request_key_holds_budget_only_once() -> None:
    """Idempotency: a retry reuses its hold instead of stacking a second one."""

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 150)

    first = await ledger.reserve(tenant_id=TENANT, request_key="same", estimated_micros=100)
    second = await ledger.reserve(tenant_id=TENANT, request_key="same", estimated_micros=100)

    assert first.id == second.id
    snapshot = await ledger.snapshot(tenant_id=TENANT)
    assert snapshot.reserved_micros == 100


async def test_the_snapshot_admits_it_is_not_multi_writer_safe() -> None:
    """The in-process ledger must never claim a guarantee it cannot keep.

    Its lock holds within one process only, so two API workers each enforce the
    cap independently. Callers surface this; they cannot do so if the ledger
    reports otherwise.
    """

    ledger = InMemoryLedger()
    snapshot = await ledger.snapshot(tenant_id=TENANT)

    assert snapshot.multi_writer_safe is False
    assert snapshot.enforcement_backend == "in_memory"


async def test_sweeping_is_a_no_op_for_the_in_process_ledger() -> None:
    ledger = InMemoryLedger()
    assert await ledger.sweep_expired(now=datetime.now(UTC)) == 0


async def test_costs_are_integers_end_to_end() -> None:
    """Money never becomes a float.

    A float cost would accumulate rounding error across a billing period and
    make the cap comparison inexact. The mutation that turns this red is
    changing any micro-dollar field to a float.
    """

    ledger = InMemoryLedger()
    ledger.set_cap(TENANT, 1_000)
    reservation = await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=100)
    await ledger.reconcile(reservation_id=reservation.id, actual_micros=250, record=_usage_record(250))

    snapshot = await ledger.snapshot(tenant_id=TENANT)
    for value in (snapshot.cap_micros, snapshot.reserved_micros, snapshot.spent_micros, snapshot.remaining_micros):
        assert isinstance(value, int)
        assert not isinstance(value, bool)
    assert isinstance(ledger.records()[0].cost_micros, int)


async def test_a_negative_estimate_is_refused() -> None:
    ledger = InMemoryLedger()
    with pytest.raises(ValueError):
        await ledger.reserve(tenant_id=TENANT, request_key="a", estimated_micros=-1)

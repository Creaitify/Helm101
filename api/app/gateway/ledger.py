"""Budget reservation, reconciliation and cap enforcement.

The naive design — record spend after a successful call — is wrong under
concurrency: unbounded simultaneous requests all pass the cap check before any
of them records. This module reserves **before** the provider call and
reconciles **after**, so the check and the hold happen together.

The failure mode is deliberately pessimistic: refusing spend a tenant could
have afforded, never spending money it did not have.

## The honest limitation

`InMemoryLedger` serializes with an `asyncio.Lock`, which holds *within one
process and nothing more*. Two API workers each enforce the cap independently,
so the effective ceiling is the cap times the worker count. That is stated in
`BudgetSnapshot.multi_writer_safe`, surfaced by the readiness endpoint, and
refused outright in staging and production by the settings guard — it is not
hidden behind a comment.

`PostgresLedger` will implement this same protocol with the cap check, the
reservation, the usage row and the audit event in one transaction under RLS.
The protocol is already `async` and already takes `request_key` so that swap
needs no caller change, and the concurrency test below runs against whichever
implementation is wired in.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from app.gateway.contracts import BudgetSnapshot, Reservation, UsageRecord
from app.gateway.errors import BudgetExceeded

# What a tenant may spend per period when nothing else is configured.
# $20.00, in micro-dollars.
DEFAULT_CAP_MICROS = 20_000_000


class BudgetLedger(Protocol):
    """The contract every ledger implementation satisfies."""

    async def reserve(self, *, tenant_id: UUID, request_key: str, estimated_micros: int) -> Reservation:
        """Hold budget for a call that is about to happen.

        Raises `BudgetExceeded` when the cap admits no further spend. The check
        and the hold must be atomic with respect to other reservations, or the
        cap does not hold under concurrency.
        """
        ...

    async def reconcile(self, *, reservation_id: UUID, actual_micros: int, record: UsageRecord) -> None:
        """Replace a hold with the real cost and record the usage."""
        ...

    async def release(self, *, reservation_id: UUID, reason: str) -> None:
        """Drop a hold whose call never produced billable usage."""
        ...

    async def sweep_expired(self, *, now: datetime) -> int:
        """Release holds abandoned by a crash mid-call. Returns the count."""
        ...

    async def snapshot(self, *, tenant_id: UUID) -> BudgetSnapshot:
        """Report a tenant's cap, holds and spend."""
        ...


@dataclass
class _TenantBudget:
    cap_micros: int
    spent_micros: int = 0
    reserved: dict[UUID, int] = field(default_factory=dict)

    @property
    def reserved_micros(self) -> int:
        return sum(self.reserved.values())


class InMemoryLedger:
    """A process-local ledger. Correct within one process; no further.

    Suitable for local development and for the single-node slice. It refuses to
    claim more than it delivers: `multi_writer_safe` is False on every
    snapshot, and callers are expected to surface that rather than round it up.
    """

    backend_name = "in_memory"

    def __init__(self, *, default_cap_micros: int = DEFAULT_CAP_MICROS) -> None:
        self._default_cap_micros = default_cap_micros
        self._budgets: dict[UUID, _TenantBudget] = {}
        self._reservation_owner: dict[UUID, UUID] = {}
        self._request_keys: dict[str, UUID] = {}
        # Reverse index, so settling a reservation can drop its request key.
        # Without it the key would outlive the reservation it names and the
        # next lookup would resolve to an id that no longer exists.
        self._key_of_reservation: dict[UUID, str] = {}
        self._records: list[UsageRecord] = []
        # One lock for the whole ledger, not one per tenant. The critical
        # section is a few dict operations, so contention is irrelevant, and a
        # single lock removes any chance of ordering bugs between tenants.
        self._lock = asyncio.Lock()

    def set_cap(self, tenant_id: UUID, cap_micros: int) -> None:
        """Set a tenant's cap. Test and provisioning helper, not a request path."""

        if cap_micros < 0:
            raise ValueError("A budget cap cannot be negative")
        self._budget_for(tenant_id).cap_micros = cap_micros

    async def reserve(self, *, tenant_id: UUID, request_key: str, estimated_micros: int) -> Reservation:
        if estimated_micros < 0:
            raise ValueError("An estimate cannot be negative")

        async with self._lock:
            # A request key that is still in flight must never hold budget
            # twice: a concurrent retry returns the existing hold rather than
            # stacking a second one on top.
            #
            # This covers in-flight duplicates only. Once a reservation is
            # settled its key is released, so a later call with the same key
            # reserves afresh and re-runs the provider. Replaying the *stored
            # response* of a completed request is the API layer's job, using
            # the `idempotency_keys` table — see `docs/api-versioning.md`.
            existing_id = self._request_keys.get(request_key)
            if existing_id is not None:
                owner = self._reservation_owner[existing_id]
                return Reservation(
                    id=existing_id,
                    tenant_id=owner,
                    request_key=request_key,
                    estimated_micros=self._budgets[owner].reserved[existing_id],
                )

            budget = self._budget_for(tenant_id)
            committed = budget.spent_micros + budget.reserved_micros
            if committed + estimated_micros > budget.cap_micros:
                raise BudgetExceeded(
                    "This tenant's model budget is exhausted. "
                    f"Cap {budget.cap_micros} micro-dollars; "
                    f"{committed} already committed."
                )

            reservation_id = uuid4()
            budget.reserved[reservation_id] = estimated_micros
            self._reservation_owner[reservation_id] = tenant_id
            self._request_keys[request_key] = reservation_id
            self._key_of_reservation[reservation_id] = request_key
            return Reservation(
                id=reservation_id,
                tenant_id=tenant_id,
                request_key=request_key,
                estimated_micros=estimated_micros,
            )

    async def reconcile(self, *, reservation_id: UUID, actual_micros: int, record: UsageRecord) -> None:
        if actual_micros < 0:
            raise ValueError("An actual cost cannot be negative")

        async with self._lock:
            tenant_id = self._reservation_owner.pop(reservation_id, None)
            if tenant_id is None:
                # Already reconciled or swept. Recording again would double-bill.
                return
            budget = self._budgets[tenant_id]
            budget.reserved.pop(reservation_id, None)
            # Spend the real cost even when it exceeds the estimate. Refusing
            # after the provider has already been paid would lose the record of
            # money that genuinely left; the overrun instead tightens the next
            # reservation.
            budget.spent_micros += actual_micros
            self._records.append(record)
            self._forget_key(reservation_id)

    async def release(self, *, reservation_id: UUID, reason: str) -> None:
        async with self._lock:
            tenant_id = self._reservation_owner.pop(reservation_id, None)
            if tenant_id is None:
                return
            self._budgets[tenant_id].reserved.pop(reservation_id, None)
            self._forget_key(reservation_id)

    async def sweep_expired(self, *, now: datetime) -> int:
        # Holds carry no expiry in the process-local ledger: a crash takes the
        # whole ledger with it, so nothing can outlive its owner. The method
        # exists because the Postgres implementation genuinely needs it, and
        # the caller should not have to know which backend it holds.
        return 0

    async def snapshot(self, *, tenant_id: UUID) -> BudgetSnapshot:
        async with self._lock:
            budget = self._budget_for(tenant_id)
            return BudgetSnapshot(
                tenant_id=tenant_id,
                cap_micros=budget.cap_micros,
                reserved_micros=budget.reserved_micros,
                spent_micros=budget.spent_micros,
                enforcement_backend=self.backend_name,
                multi_writer_safe=False,
            )

    def records(self) -> list[UsageRecord]:
        """Every reconciled usage record, for tests and local inspection."""

        return list(self._records)

    def _forget_key(self, reservation_id: UUID) -> None:
        """Release a settled reservation's request key.

        Leaving the key mapped would point it at an id that no longer exists,
        so the next lookup for that key would fail rather than reserve.
        """

        request_key = self._key_of_reservation.pop(reservation_id, None)
        if request_key is not None:
            self._request_keys.pop(request_key, None)

    def _budget_for(self, tenant_id: UUID) -> _TenantBudget:
        budget = self._budgets.get(tenant_id)
        if budget is None:
            budget = _TenantBudget(cap_micros=self._default_cap_micros)
            self._budgets[tenant_id] = budget
        return budget

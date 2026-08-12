"""The gateway service: the only door to model providers.

Composes one sequence, in this order, for every model call in the platform:

    resolve policy → check kill switch → reserve budget
        → call adapter → reconcile actual cost → record usage

The ordering is the design. Reserving before the call is what makes a spend cap
hold under concurrency; reconciling after is what keeps the ledger honest when
the real cost differs from the estimate. A failed call releases its hold rather
than leaving budget stranded.

Callers name a `TaskKind`, never a model. Nothing outside `adapters/` knows
which vendor serves a task.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from datetime import datetime
from uuid import UUID

import structlog

from app.gateway.adapters.base import ProviderAdapter
from app.gateway.contracts import (
    BudgetSnapshot,
    CompletionRequest,
    CompletionResponse,
    UsageRecord,
)
from app.gateway.errors import GatewayError, KillSwitchEngaged, ModelNotPermitted
from app.gateway.ledger import BudgetLedger
from app.gateway.policy import POLICY_VERSION, TaskPolicy, resolve
from app.gateway.ratecard import RATE_CARD_VERSION, actual_micros, estimate_micros

logger = structlog.get_logger(__name__)

# Rough characters-per-token ratio, used only to size a reservation before the
# provider reports real usage. It does not need to be accurate, only
# conservative: an over-estimate refuses spend the tenant could have afforded,
# while an under-estimate would let a tenant overshoot its cap.
_CHARS_PER_TOKEN = 3


class GatewayService:
    """Policy, budget and audit wrapped around a provider adapter."""

    def __init__(
        self,
        *,
        adapter: ProviderAdapter,
        ledger: BudgetLedger,
        kill_switch: Callable[[], bool] | None = None,
    ) -> None:
        self._adapter = adapter
        self._ledger = ledger
        self._kill_switch = kill_switch or (lambda: False)

    async def complete(
        self,
        request: CompletionRequest,
        *,
        tenant_id: UUID,
        idempotency_key: str | None = None,
        run_id: UUID | None = None,
    ) -> CompletionResponse:
        policy = resolve(request.task)
        self._assert_permitted(policy)

        # Checked here rather than only in the worker: a worker-side check saves
        # a round trip but is not a control, because anything that can reach the
        # gateway must be refused when egress is frozen.
        if self._kill_switch():
            raise KillSwitchEngaged()

        request_key = idempotency_key or self._derive_request_key(request, tenant_id)
        estimate = estimate_micros(
            policy.model.model,
            prompt_tokens=self._estimate_prompt_tokens(request),
            max_tokens=min(request.max_tokens, policy.capabilities.max_output_tokens),
        )

        reservation = await self._ledger.reserve(
            tenant_id=tenant_id,
            request_key=request_key,
            estimated_micros=estimate,
        )

        try:
            response = await self._adapter.complete(request, policy)
        except GatewayError:
            # The call produced no billable usage, so the hold is returned in
            # full. Without this a failing provider would silently exhaust a
            # tenant's budget.
            await self._ledger.release(reservation_id=reservation.id, reason="provider_error")
            raise
        except Exception:
            await self._ledger.release(reservation_id=reservation.id, reason="unexpected_error")
            raise

        cost = actual_micros(policy.model.model, response.usage)
        record = UsageRecord(
            tenant_id=tenant_id,
            task=request.task,
            model=response.model,
            usage=response.usage,
            cost_micros=cost,
            latency_ms=response.latency_ms,
            outcome="success",
            request_id=request.request_id,
            rate_card_version=RATE_CARD_VERSION,
            run_id=run_id,
            metadata={"policy_version": POLICY_VERSION},
        )
        await self._ledger.reconcile(
            reservation_id=reservation.id,
            actual_micros=cost,
            record=record,
        )

        logger.info(
            "gateway.completion",
            task=request.task.value,
            model=response.model.model,
            cost_micros=cost,
            estimated_micros=estimate,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cache_read_tokens=response.usage.cache_read_tokens,
            latency_ms=response.latency_ms,
            request_id=request.request_id,
        )
        return response

    async def budget(self, *, tenant_id: UUID) -> BudgetSnapshot:
        return await self._ledger.snapshot(tenant_id=tenant_id)

    async def sweep(self, *, now: datetime) -> int:
        return await self._ledger.sweep_expired(now=now)

    async def aclose(self) -> None:
        await self._adapter.aclose()

    def _assert_permitted(self, policy: TaskPolicy) -> None:
        if not self._adapter.serves(policy.model.provider):
            raise ModelNotPermitted(
                f"No adapter is configured for provider {policy.model.provider!r}."
            )

    def _estimate_prompt_tokens(self, request: CompletionRequest) -> int:
        characters = len(request.system_cacheable) + len(request.system_volatile)
        characters += sum(len(message.content) for message in request.messages)
        return max(1, characters // _CHARS_PER_TOKEN)

    def _derive_request_key(self, request: CompletionRequest, tenant_id: UUID) -> str:
        """Derive a stable key when the caller supplies no idempotency key.

        Hashing the content means a retry of the identical request reuses its
        reservation instead of holding budget twice. It is a weaker guarantee
        than a caller-supplied key — two genuinely distinct but identical
        requests collide — which is why the caller-supplied key wins whenever
        one is present.
        """

        digest = hashlib.sha256()
        digest.update(str(tenant_id).encode())
        digest.update(request.task.value.encode())
        digest.update(request.system_cacheable.encode())
        digest.update(request.system_volatile.encode())
        for message in request.messages:
            digest.update(message.role.value.encode())
            digest.update(message.content.encode())
        return digest.hexdigest()

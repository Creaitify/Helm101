"""The adapter contract every provider implementation satisfies.

An adapter translates contract in → provider call → contract out, and does
nothing else: no budget arithmetic, no audit, no policy decisions. Those belong
to `service.py`, which composes them around whichever adapter is selected. That
split is what makes a second provider a new file rather than a change to the
service.
"""

from __future__ import annotations

from typing import Protocol

from app.gateway.contracts import CompletionRequest, CompletionResponse
from app.gateway.policy import TaskPolicy


class ProviderAdapter(Protocol):
    """Translates a provider-neutral request into one provider's API."""

    provider: str

    def serves(self, provider: str) -> bool:
        """Whether this adapter can serve a task routed to `provider`.

        A real adapter serves exactly one vendor. The replay adapter serves any
        of them, because it replays contract-level fixtures rather than a
        vendor's wire format — which is what lets the full service path be
        exercised offline without pretending to be a specific vendor.
        """
        ...

    async def complete(self, request: CompletionRequest, policy: TaskPolicy) -> CompletionResponse:
        """Run one generation.

        Implementations must map transport and protocol failures onto the typed
        errors in `app.gateway.errors`, and must never let a raw provider
        message escape — it can carry prompt fragments or account detail.
        """
        ...

    async def aclose(self) -> None:
        """Release any client resources held by the adapter."""
        ...

"""An adapter that replays recorded responses instead of calling a provider.

Two jobs, both of which need the real code path exercised rather than mocked:

- **Tests** run the full service — policy, reservation, reconciliation, audit —
  without a network call or a cent of spend.
- **Local demos** work with no provider key at all.

It names no vendor, because it replays *contract-level* fixtures rather than a
provider's wire format. That keeps the vendor confined to one module, and it
means these fixtures stay valid when a provider changes its response shape.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.gateway.contracts import (
    CompletionRequest,
    CompletionResponse,
    ModelRef,
    StopReason,
    Usage,
)
from app.gateway.errors import GatewayError, ProviderRefused
from app.gateway.policy import TaskPolicy

PROVIDER = "replay"


@dataclass(frozen=True, slots=True)
class RecordedCompletion:
    """One canned outcome: either a response body or a failure."""

    text: str = ""
    stop_reason: StopReason = StopReason.END_TURN
    input_tokens: int = 1_000
    output_tokens: int = 250
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    latency_ms: int = 42
    raises: GatewayError | None = None


class ReplayAdapter:
    """Serves recorded completions in order, then repeats the last one.

    Repeating rather than exhausting is deliberate: a test that asserts on
    concurrency or retry behaviour should not have to enumerate one fixture per
    attempt, and a demo should not fall over after N questions.
    """

    provider = PROVIDER

    def __init__(
        self,
        recordings: Sequence[RecordedCompletion] | None = None,
        *,
        responder: Callable[[CompletionRequest], RecordedCompletion] | None = None,
    ) -> None:
        if recordings and responder:
            raise ValueError("Provide recordings or a responder, not both")
        self._recordings = list(recordings or [RecordedCompletion(text="Recorded reply.")])
        self._responder = responder
        self._calls: list[CompletionRequest] = []

    def serves(self, provider: str) -> bool:
        """Serves any provider.

        The fixtures are contract-level, so they stand in for whichever vendor
        the routing table names. Restricting this to one provider would make
        the replay path unusable for exactly the routes it exists to exercise.
        """

        return True

    @property
    def calls(self) -> list[CompletionRequest]:
        """Every request seen, so tests can assert on what was actually sent."""

        return list(self._calls)

    async def complete(self, request: CompletionRequest, policy: TaskPolicy) -> CompletionResponse:
        self._calls.append(request)

        if self._responder is not None:
            recording = self._responder(request)
        else:
            index = min(len(self._calls) - 1, len(self._recordings) - 1)
            recording = self._recordings[index]

        if recording.raises is not None:
            raise recording.raises
        if recording.stop_reason is StopReason.REFUSAL:
            raise ProviderRefused()

        return CompletionResponse(
            text=recording.text,
            stop_reason=recording.stop_reason,
            model=ModelRef(provider=PROVIDER, model=policy.model.model),
            usage=Usage(
                input_tokens=recording.input_tokens,
                output_tokens=recording.output_tokens,
                cache_read_tokens=recording.cache_read_tokens,
                cache_write_tokens=recording.cache_write_tokens,
            ),
            latency_ms=recording.latency_ms,
        )

    async def aclose(self) -> None:
        return None

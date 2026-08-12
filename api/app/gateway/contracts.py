"""Provider-neutral request, response and usage types.

This module is the extraction-ready boundary. It is pure: no I/O, no SDK
imports, and — deliberately — no vendor name anywhere. A second provider is a
new adapter file, never a change to these types or to the service that composes
them.

Money is integer micro-dollars throughout. Floating point never touches a cost,
matching the "integer minor units, never floating point" rule the deleted
Phase A schema established for rupee amounts.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID


class TaskKind(StrEnum):
    """Logical capabilities a caller may request.

    Callers name a task, never a model. The routing table in `policy.py` maps
    each task to a concrete provider and model, so swapping models is a config
    edit rather than a change at every call site.
    """

    ANALYST_ANSWER = "analyst.answer"
    ANALYST_ROUTE = "analyst.route"


class Role(StrEnum):
    """Conversation roles the gateway accepts."""

    USER = "user"
    ASSISTANT = "assistant"


class StopReason(StrEnum):
    """Why generation stopped.

    `REFUSAL` is not an error: providers may return it with a success status
    when a safety classifier declines the request. `service.py` maps it to a
    typed error so no caller can mistake a refusal for an answer.
    """

    END_TURN = "end_turn"
    MAX_TOKENS = "max_tokens"
    TOOL_USE = "tool_use"
    REFUSAL = "refusal"


class Effort(StrEnum):
    """How much reasoning depth and token spend a task warrants."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


@dataclass(frozen=True, slots=True)
class Message:
    """One conversation turn."""

    role: Role
    content: str


@dataclass(frozen=True, slots=True)
class ModelRef:
    """A concrete provider and model, resolved from a task by the routing table."""

    provider: str
    model: str


@dataclass(frozen=True, slots=True)
class CompletionRequest:
    """A provider-neutral generation request.

    `system_cacheable` is separated from `system_volatile` because prompt
    caching is a prefix match: any byte change invalidates everything after it.
    The stable part (instructions, the corpus manifest) goes first and is
    cached; anything varying per request goes after the breakpoint.
    """

    task: TaskKind
    messages: Sequence[Message]
    system_cacheable: str = ""
    system_volatile: str = ""
    max_tokens: int = 4096
    effort: Effort = Effort.HIGH
    json_schema: Mapping[str, object] | None = None
    request_id: str = ""

    def __post_init__(self) -> None:
        if not self.messages:
            raise ValueError("A completion request needs at least one message")
        if self.max_tokens <= 0:
            raise ValueError("max_tokens must be positive")


@dataclass(frozen=True, slots=True)
class Usage:
    """What one provider call consumed.

    `cache_read_tokens` is recorded rather than inferred: it is the only honest
    way to confirm prompt caching is actually working. If it stays zero across
    requests that share a prefix, something is invalidating the cache.
    """

    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def __post_init__(self) -> None:
        for name in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} cannot be negative")


@dataclass(frozen=True, slots=True)
class CompletionResponse:
    """A provider-neutral generation result."""

    text: str
    stop_reason: StopReason
    model: ModelRef
    usage: Usage
    latency_ms: int
    refusal_category: str | None = None


@dataclass(frozen=True, slots=True)
class Reservation:
    """A budget hold taken before a provider call.

    Reserving before the call is what makes the cap hold under concurrency: a
    design that records spend afterwards lets unbounded simultaneous requests
    all pass the check before any of them writes.
    """

    id: UUID
    tenant_id: UUID
    request_key: str
    estimated_micros: int


@dataclass(frozen=True, slots=True)
class BudgetSnapshot:
    """What a tenant has spent and may still spend, in micro-dollars."""

    tenant_id: UUID
    cap_micros: int
    reserved_micros: int
    spent_micros: int
    enforcement_backend: str
    multi_writer_safe: bool

    @property
    def remaining_micros(self) -> int:
        return max(0, self.cap_micros - self.reserved_micros - self.spent_micros)


@dataclass(frozen=True, slots=True)
class UsageRecord:
    """A durable record of one billable provider call."""

    tenant_id: UUID
    task: TaskKind
    model: ModelRef
    usage: Usage
    cost_micros: int
    latency_ms: int
    outcome: str
    request_id: str
    rate_card_version: str
    run_id: UUID | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

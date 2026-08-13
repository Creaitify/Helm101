"""Versioned routing from a logical task to a concrete model and its limits.

Callers name a `TaskKind`; this table decides which provider and model serves
it. That indirection is what lets a model change be a config edit rather than a
change at every call site.

Open decision #9 (approved models, allowed data classes per provider, regional
processing) is **not resolved here**. It is made explicit and versioned instead,
so the choices are auditable rather than scattered through the code.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.gateway.contracts import Effort, ModelRef, TaskKind

POLICY_VERSION = "2026-08-12"

ANTHROPIC = "anthropic"


@dataclass(frozen=True, slots=True)
class ModelCapabilities:
    """What request parameters a model actually accepts.

    These are not stylistic preferences — sending an unsupported parameter is a
    400. `supports_effort` is false for the Haiku tier, which rejects the effort
    parameter outright, and `thinking_on_by_default` records that the current
    Opus tier thinks unless told otherwise, so `max_tokens` has to leave room
    for reasoning as well as the answer.
    """

    supports_effort: bool
    supports_adaptive_thinking: bool
    thinking_on_by_default: bool
    max_output_tokens: int


CAPABILITIES: dict[str, ModelCapabilities] = {
    "claude-opus-5": ModelCapabilities(
        supports_effort=True,
        supports_adaptive_thinking=True,
        thinking_on_by_default=True,
        max_output_tokens=128_000,
    ),
    "claude-haiku-4-5": ModelCapabilities(
        supports_effort=False,
        supports_adaptive_thinking=False,
        thinking_on_by_default=False,
        max_output_tokens=64_000,
    ),
}


@dataclass(frozen=True, slots=True)
class TaskPolicy:
    """How one logical task is served."""

    model: ModelRef
    default_effort: Effort
    default_max_tokens: int
    timeout_seconds: float
    allowed_data_classes: frozenset[str]

    @property
    def capabilities(self) -> ModelCapabilities:
        return CAPABILITIES[self.model.model]


# `platform_docs` is the only data class this slice permits. The knowledge
# corpus is HELM's own documentation — shared across tenants and classified
# "public/internal operational" — never tenant personal data. Widening this set
# is a compliance decision, not an engineering one.
_PLATFORM_DOCS = frozenset({"platform_docs"})


ROUTING_TABLE: dict[TaskKind, TaskPolicy] = {
    TaskKind.ANALYST_ANSWER: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-opus-5"),
        default_effort=Effort.HIGH,
        default_max_tokens=8_192,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    TaskKind.ANALYST_ROUTE: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-haiku-4-5"),
        default_effort=Effort.LOW,
        default_max_tokens=1_024,
        timeout_seconds=30.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    # The agent tasks. All three reason over sample campaign data or briefs —
    # nothing tenant-personal — so they stay inside the platform_docs class
    # until the data-classification decision widens it.
    TaskKind.MEDIA_BUYER_PROPOSAL: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-opus-5"),
        default_effort=Effort.HIGH,
        default_max_tokens=4_096,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    TaskKind.CREATIVE_VARIANTS: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-opus-5"),
        default_effort=Effort.HIGH,
        default_max_tokens=4_096,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    TaskKind.GOVERNOR_PLAN: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-opus-5"),
        default_effort=Effort.HIGH,
        default_max_tokens=4_096,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
}


def resolve(task: TaskKind) -> TaskPolicy:
    """Return the policy serving a task.

    Raises rather than defaulting: an unrouted task means someone added a
    capability without deciding which model should serve it, and guessing would
    bill a tenant for a model nobody approved.
    """

    try:
        return ROUTING_TABLE[task]
    except KeyError:
        raise KeyError(f"No routing policy for task {task!r}") from None

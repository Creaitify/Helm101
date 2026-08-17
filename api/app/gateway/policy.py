"""Versioned routing from a logical task to a concrete model and its limits.

Callers name a `TaskKind`; this table decides which provider and model serves
it. That indirection is what lets a model change be a config edit rather than a
change at every call site.

Open decision #9 (approved models, allowed data classes per provider, regional
processing) is **not resolved here**. It is made explicit and versioned instead,
so the choices are auditable rather than scattered through the code.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

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
    "claude-sonnet-5": ModelCapabilities(
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
class ModelOption:
    """One model an operator may select from the UI."""

    id: str
    label: str
    tier: str
    input_per_mtok_usd: float
    output_per_mtok_usd: float
    note: str


# The switchable roster. Every entry must have a CAPABILITIES row and a rate
# card entry, or resolve()/pricing would fail at call time.
AVAILABLE_MODELS: tuple[ModelOption, ...] = (
    ModelOption(
        id="claude-opus-5",
        label="Claude Opus 5",
        tier="opus",
        input_per_mtok_usd=5.0,
        output_per_mtok_usd=25.0,
        note="Deepest reasoning — highest cost. Use for hard strategy runs.",
    ),
    ModelOption(
        id="claude-sonnet-5",
        label="Claude Sonnet 5",
        tier="sonnet",
        input_per_mtok_usd=3.0,
        output_per_mtok_usd=15.0,
        note="Near-Opus quality at ~40% of the cost. Recommended default.",
    ),
    ModelOption(
        id="claude-haiku-4-5",
        label="Claude Haiku 4.5",
        tier="haiku",
        input_per_mtok_usd=1.0,
        output_per_mtok_usd=5.0,
        note="Fastest and cheapest. Fine for routine relays and demos.",
    ),
)

_AVAILABLE_MODEL_IDS = frozenset(option.id for option in AVAILABLE_MODELS)

# Operator-selected model override, applied to every task at resolve time.
# In-memory by design: it is a per-process dev/ops knob, not tenant state.
_model_override: str | None = None


def set_model_override(model_id: str | None) -> None:
    """Point every task at one model, or clear the override with None."""

    global _model_override
    if model_id is not None and model_id not in _AVAILABLE_MODEL_IDS:
        raise KeyError(f"Unknown model {model_id!r}; choose one of {sorted(_AVAILABLE_MODEL_IDS)}")
    _model_override = model_id


def get_model_override() -> str | None:
    return _model_override


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


# Token thrift is enforced here, not hoped for at call sites: the adapter clamps
# every request to `default_max_tokens`, and `default_effort` is what actually
# gets sent as `output_config.effort`. Each task's cap leaves room for adaptive
# thinking plus its small structured answer — these tasks emit compact JSON or a
# short grounded markdown answer, never essays.
ROUTING_TABLE: dict[TaskKind, TaskPolicy] = {
    TaskKind.ANALYST_ANSWER: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-sonnet-5"),
        default_effort=Effort.MEDIUM,
        default_max_tokens=4_096,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    TaskKind.ANALYST_ROUTE: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-haiku-4-5"),
        default_effort=Effort.LOW,
        default_max_tokens=512,
        timeout_seconds=30.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    # The agent tasks. All three reason over sample campaign data or briefs —
    # nothing tenant-personal — so they stay inside the platform_docs class
    # until the data-classification decision widens it.
    TaskKind.MEDIA_BUYER_PROPOSAL: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-sonnet-5"),
        default_effort=Effort.LOW,
        default_max_tokens=2_048,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    TaskKind.CREATIVE_VARIANTS: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-sonnet-5"),
        default_effort=Effort.LOW,
        default_max_tokens=2_048,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
    TaskKind.GOVERNOR_PLAN: TaskPolicy(
        model=ModelRef(provider=ANTHROPIC, model="claude-sonnet-5"),
        default_effort=Effort.LOW,
        default_max_tokens=1_024,
        timeout_seconds=120.0,
        allowed_data_classes=_PLATFORM_DOCS,
    ),
}


def resolve(task: TaskKind) -> TaskPolicy:
    """Return the policy serving a task, honoring the operator model override.

    Raises rather than defaulting: an unrouted task means someone added a
    capability without deciding which model should serve it, and guessing would
    bill a tenant for a model nobody approved.
    """

    try:
        policy = ROUTING_TABLE[task]
    except KeyError:
        raise KeyError(f"No routing policy for task {task!r}") from None

    if _model_override is not None and _model_override != policy.model.model:
        policy = replace(policy, model=ModelRef(provider=ANTHROPIC, model=_model_override))
    return policy

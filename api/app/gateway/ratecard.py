"""Versioned model pricing, in integer micro-dollars per token.

Prices are versioned and every usage row records the version that priced it, so
a rate change never silently rewrites history. Model ids and prices belong here
rather than inline in adapters or in architecture prose, which goes stale — see
the audit's note that model IDs and rates should live in versioned config and
be revalidated at release time.

Rates as published 2026-08-12, per million tokens:

    claude-opus-5      $5 in  / $25 out
    claude-sonnet-5    $3 in  / $15 out (sticker; intro pricing not assumed)
    claude-haiku-4-5   $1 in  / $5  out

A cache read costs a tenth of the input rate; a cache write costs 1.25x.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.gateway.contracts import Usage

RATE_CARD_VERSION = "2026-08-12"

_MICROS_PER_DOLLAR = 1_000_000
_TOKENS_PER_MILLION = 1_000_000

CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25


@dataclass(frozen=True, slots=True)
class ModelRate:
    """Per-million-token prices in micro-dollars."""

    input_micros_per_mtok: int
    output_micros_per_mtok: int


RATE_CARD: dict[str, ModelRate] = {
    "claude-opus-5": ModelRate(
        input_micros_per_mtok=5 * _MICROS_PER_DOLLAR,
        output_micros_per_mtok=25 * _MICROS_PER_DOLLAR,
    ),
    "claude-sonnet-5": ModelRate(
        input_micros_per_mtok=3 * _MICROS_PER_DOLLAR,
        output_micros_per_mtok=15 * _MICROS_PER_DOLLAR,
    ),
    "claude-haiku-4-5": ModelRate(
        input_micros_per_mtok=1 * _MICROS_PER_DOLLAR,
        output_micros_per_mtok=5 * _MICROS_PER_DOLLAR,
    ),
}


def rate_for(model: str) -> ModelRate:
    """Return the rate for a model, refusing to guess at an unknown one.

    Falling back to a default price would under-report spend for a model nobody
    reviewed, which is worse than failing loudly at the point of change.
    """

    try:
        return RATE_CARD[model]
    except KeyError:
        raise KeyError(f"No rate card entry for model {model!r}; add one before routing to it") from None


def _scale(tokens: int, micros_per_mtok: int) -> int:
    """Price `tokens` at a per-million rate, rounding up.

    Rounding up rather than to nearest keeps the ledger pessimistic: the failure
    mode is refusing spend the tenant could have afforded, never spending money
    it did not have.
    """

    return -(-tokens * micros_per_mtok // _TOKENS_PER_MILLION)


def estimate_micros(model: str, prompt_tokens: int, max_tokens: int) -> int:
    """Price the worst case for a call that has not happened yet.

    Deliberately assumes every one of `max_tokens` is generated. A reservation
    that under-estimates lets a tenant overshoot its cap; one that
    over-estimates only refuses spend it could have afforded.
    """

    rate = rate_for(model)
    return _scale(prompt_tokens, rate.input_micros_per_mtok) + _scale(max_tokens, rate.output_micros_per_mtok)


def actual_micros(model: str, usage: Usage) -> int:
    """Price a completed call from its reported usage."""

    rate = rate_for(model)
    total = _scale(usage.input_tokens, rate.input_micros_per_mtok)
    total += _scale(usage.output_tokens, rate.output_micros_per_mtok)
    total += _scale(usage.cache_read_tokens, int(rate.input_micros_per_mtok * CACHE_READ_MULTIPLIER))
    total += _scale(usage.cache_write_tokens, int(rate.input_micros_per_mtok * CACHE_WRITE_MULTIPLIER))
    return total

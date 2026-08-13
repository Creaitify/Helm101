"""Deterministic compliance rules for financial marketing copy.

A model verdict is never the compliance gate — the audit is explicit about
this. These rules are versioned code: a hard match blocks a variant outright
and no approval can ship it; a warn match flags it for the human deciding.
The LLM's opinion is welcome as *input* upstream; the verdict happens here.

This list is a starting rule corpus for SEBI-adjacent advertising language
(assured/guaranteed returns and risk-denial phrasing). It is deliberately
small and obvious; widening it is a compliance-owner decision (open decision
in `docs/open-decisions.md`), not an engineering one. The version tag below
rides on every verdict so a stored decision can name the rules it was made
under.
"""

from __future__ import annotations

from dataclasses import dataclass

RULES_VERSION = "2026-08-13.1"

# A hard match can never ship. Approval does not override it.
HARD_BLOCK: tuple[str, ...] = (
    "assured return",
    "guaranteed return",
    "guaranteed profit",
    "assured profit",
    "risk-free",
    "risk free",
    "no risk",
    "zero risk",
    "double your money",
    "cannot lose",
)

# A warn match ships only through an explicit human approval, and the flag
# stays on the record.
WARN: tuple[str, ...] = (
    "guaranteed",
    "assured",
    "highest returns",
    "best returns",
    "safe investment",
    "always profitable",
)


@dataclass(frozen=True, slots=True)
class Verdict:
    """One variant's compliance outcome."""

    status: str  # "pass" | "flag" | "block"
    matched: list[str]
    rules_version: str = RULES_VERSION


def check(text: str) -> Verdict:
    """Check one piece of copy against the rules. Case-insensitive, substring.

    Substring matching over-matches on purpose: "risk-free*" hidden inside a
    longer word still blocks. A false positive costs a human a glance; a false
    negative ships a prohibited claim.
    """

    lowered = text.lower()
    blocked = [phrase for phrase in HARD_BLOCK if phrase in lowered]
    if blocked:
        return Verdict(status="block", matched=blocked)
    warned = [phrase for phrase in WARN if phrase in lowered]
    if warned:
        return Verdict(status="flag", matched=warned)
    return Verdict(status="pass", matched=[])

"""The budget policy, enforced in code below the model.

The model proposes; this module decides what a proposal is allowed to mean.
Nothing here trusts the model's arithmetic or its restraint — every rule is
checked against the campaign snapshot, and every correction is recorded as a
note a human will see next to the proposal.

Rules, in the order applied:

1. A shift must name a campaign that exists in the snapshot. Unknown ids are
   dropped, not guessed at.
2. A proposed budget must be a positive number. Anything else is dropped.
3. One shift per campaign: a duplicate is dropped, keeping the first.
4. A budget may move at most ±25% in one proposal. Larger moves are clamped —
   big reallocations happen over several approved steps, not one.
5. The proposal cannot create money: the proposed total across shifted
   campaigns may not exceed their current total. Increases are trimmed,
   largest first, until the total balances.
6. A shift that ends up exactly at the current budget says nothing; dropped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypedDict

MAX_SHIFT_FRACTION = 0.25


class Shift(TypedDict):
    """One validated budget move, ready for a human to read."""

    campaign_id: str
    current_budget: float
    proposed_budget: float
    reason: str


@dataclass(frozen=True, slots=True)
class PolicyResult:
    """What survived the rules, plus a note for every correction."""

    shifts: list[Shift] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _as_positive_number(value: object) -> float | None:
    # bool is an int subclass; True must not become a ₹1 budget.
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if value > 0 else None


def apply_policy(campaigns: list[dict[str, object]], shifts: list[dict[str, object]]) -> PolicyResult:
    budgets: dict[str, float] = {}
    for campaign in campaigns:
        amount = _as_positive_number(campaign.get("daily_budget"))
        if amount is not None:
            budgets[str(campaign["id"])] = amount

    notes: list[str] = []
    accepted: list[Shift] = []
    seen: set[str] = set()

    for raw in shifts:
        campaign_id = str(raw.get("campaign_id", ""))
        current = budgets.get(campaign_id)
        if current is None:
            notes.append(f"dropped shift for unknown campaign {campaign_id!r}")
            continue
        if campaign_id in seen:
            notes.append(f"dropped duplicate shift for {campaign_id}")
            continue

        proposed = _as_positive_number(raw.get("proposed_budget"))
        if proposed is None:
            notes.append(
                f"dropped shift for {campaign_id}: proposed budget {raw.get('proposed_budget')!r} "
                "is not a positive number"
            )
            continue

        seen.add(campaign_id)
        low = current * (1 - MAX_SHIFT_FRACTION)
        high = current * (1 + MAX_SHIFT_FRACTION)
        if proposed < low or proposed > high:
            clamped = min(max(proposed, low), high)
            notes.append(
                # ASCII arrow: this string is printed to Windows consoles
                # whose cp1252 codec cannot encode U+2192.
                f"clamped {campaign_id} to +/-{int(MAX_SHIFT_FRACTION * 100)}%: {int(proposed)} -> {int(clamped)}"
            )
            proposed = clamped

        accepted.append(
            Shift(
                campaign_id=campaign_id,
                current_budget=current,
                proposed_budget=proposed,
                reason=str(raw.get("reason", "")),
            )
        )

    # Rule 5: no new money. Trim increases, largest first, until the totals
    # balance. Decreases are never touched — freeing budget is always allowed.
    excess = sum(s["proposed_budget"] for s in accepted) - sum(s["current_budget"] for s in accepted)
    if excess > 0:
        increases = sorted(
            (s for s in accepted if s["proposed_budget"] > s["current_budget"]),
            key=lambda s: s["proposed_budget"] - s["current_budget"],
            reverse=True,
        )
        for shift in increases:
            if excess <= 0:
                break
            headroom = shift["proposed_budget"] - shift["current_budget"]
            trim = min(headroom, excess)
            shift["proposed_budget"] -= trim
            excess -= trim
            notes.append(f"trimmed {shift['campaign_id']} by {int(trim)} to keep the total budget unchanged")

    survivors = [s for s in accepted if s["proposed_budget"] != s["current_budget"]]
    for dropped in accepted:
        if dropped not in survivors:
            notes.append(f"dropped no-op shift for {dropped['campaign_id']}")

    return PolicyResult(shifts=survivors, notes=notes)

"""SAMPLE campaign data for the Media Buyer.

Synthetic, and labelled as such everywhere it surfaces. The real campaign
store is Phase 2 (domain endpoints in FastAPI); until it exists this snapshot
is the agent's whole world, deliberately mirroring the numbers the demo UI
shows so a proposal reads consistently against the dashboard.

Budgets are daily, in whole rupees. `cac` is cost per checkup over the last
30 days; `roas` is blended return on ad spend.
"""

from __future__ import annotations

SAMPLE_LABEL = "sample-2026-08"

SAMPLE_CAMPAIGNS: list[dict[str, object]] = [
    {
        "id": "fhc-meta-retargeting",
        "name": "FHC · Meta Retargeting",
        "channel": "meta",
        "daily_budget": 40_000,
        "spend_30d": 118_000,
        "results_30d": 346,
        "cac": 341,
        "roas": 3.4,
    },
    {
        "id": "fhc-meta-prospecting",
        "name": "FHC · Meta Prospecting",
        "channel": "meta",
        "daily_budget": 60_000,
        "spend_30d": 176_000,
        "results_30d": 381,
        "cac": 462,
        "roas": 2.6,
    },
    {
        "id": "search-brand",
        "name": "Search · Brand",
        "channel": "google",
        "daily_budget": 25_000,
        "spend_30d": 74_000,
        "results_30d": 186,
        "cac": 398,
        "roas": 3.1,
    },
    {
        "id": "search-competitor",
        "name": "Search · Competitor",
        "channel": "google",
        "daily_budget": 30_000,
        "spend_30d": 88_000,
        "results_30d": 160,
        "cac": 550,
        "roas": 1.7,
    },
    {
        "id": "whatsapp-nurture",
        "name": "WhatsApp Nurture",
        "channel": "whatsapp",
        "daily_budget": 12_000,
        "spend_30d": 34_000,
        "results_30d": 91,
        "cac": 375,
        "roas": 2.9,
    },
]

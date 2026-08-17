"""Campaign data sources: a fresh synthetic snapshot per run, or live ad accounts.

Every run reasons over its own campaign snapshot:

- **synthetic** (default): randomized-but-realistic numbers generated per
  session, so no two runs see identical data and the agents cannot memorize a
  fixture. Deterministic when given a seed (tests), random otherwise.
- **live**: when Meta and/or Google Ads credentials are present in the
  environment, campaigns and 30-day metrics are pulled from the real accounts.
  Any fetch failure falls back to synthetic — labelled as such — because a
  relay that dies on an expired ads token helps nobody.

Ads tokens are data-plane credentials, deliberately distinct from the
forbidden model-provider keys guarded in `config.py`.

Live-mode environment variables:

    Meta:   META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (numeric, no "act_" prefix)
    Google: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
            GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
            GOOGLE_ADS_CUSTOMER_ID (and optional GOOGLE_ADS_LOGIN_CUSTOMER_ID)
"""

from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

META_API_VERSION = "v20.0"
GOOGLE_ADS_API_VERSION = "v17"

# (id, name, channel, base daily budget ₹, base CAC ₹, base ROAS)
# Ids stay stable across runs — the UI and ad-platform router key on them —
# while every metric is re-rolled per session.
_TEMPLATES: tuple[tuple[str, str, str, int, int, float], ...] = (
    ("fhc-meta-retargeting", "FHC · Meta Retargeting", "meta", 40_000, 341, 3.4),
    ("fhc-meta-prospecting", "FHC · Meta Prospecting", "meta", 60_000, 462, 2.6),
    ("search-brand", "Search · Brand Intent", "google", 25_000, 398, 3.1),
    ("search-competitor", "Search · Competitor Terms", "google", 30_000, 550, 1.7),
    ("whatsapp-nurture", "WhatsApp · Cart Recovery", "whatsapp", 12_000, 375, 2.9),
    ("pmax-tier1-wealth", "Google PMax · Tier 1 Metros", "google", 35_000, 421, 2.8),
    ("youtube-explainer-video", "YouTube · 60s Fee-Only Review", "google", 20_000, 504, 2.1),
    ("email-lead-reengagement", "Email · Inactive Lead Nurture", "email", 8_000, 297, 3.8),
)


@dataclass(frozen=True, slots=True)
class CampaignSnapshot:
    """One run's view of the ad account: the data plus where it came from."""

    campaigns: list[dict[str, Any]]
    label: str
    mode: str  # "synthetic" | "live" | "synthetic-fallback"
    notes: list[str] = field(default_factory=list)


def generate_synthetic_campaigns(seed: int | str | None = None) -> list[dict[str, Any]]:
    """Roll a fresh, internally consistent campaign snapshot.

    Budgets move ±30%, CAC ±20/+25%, ROAS ±0.6 around realistic anchors, and
    spend/results are derived from those so the numbers always reconcile —
    an agent computing spend/results should land near the reported CAC.
    """

    rng = random.Random(seed if seed is not None else time.time_ns())
    campaigns: list[dict[str, Any]] = []
    for campaign_id, name, channel, base_budget, base_cac, base_roas in _TEMPLATES:
        daily_budget = int(round(base_budget * rng.uniform(0.70, 1.30) / 500) * 500)
        cac = int(base_cac * rng.uniform(0.80, 1.25))
        roas = round(max(0.8, base_roas + rng.uniform(-0.6, 0.6)), 1)
        spend_30d = int(daily_budget * 30 * rng.uniform(0.80, 1.02) // 1_000 * 1_000)
        results_30d = max(5, spend_30d // max(cac, 1))
        campaigns.append(
            {
                "id": campaign_id,
                "name": name,
                "channel": channel,
                "daily_budget": daily_budget,
                "spend_30d": spend_30d,
                "results_30d": results_30d,
                "cac": cac,
                "roas": roas,
            }
        )
    return campaigns


def _meta_configured() -> bool:
    return bool(os.environ.get("META_ACCESS_TOKEN") and os.environ.get("META_AD_ACCOUNT_ID"))


def _google_configured() -> bool:
    required = (
        "GOOGLE_ADS_DEVELOPER_TOKEN",
        "GOOGLE_ADS_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET",
        "GOOGLE_ADS_REFRESH_TOKEN",
        "GOOGLE_ADS_CUSTOMER_ID",
    )
    return all(os.environ.get(name) for name in required)


def fetch_meta_campaigns(timeout_seconds: float = 8.0) -> list[dict[str, Any]]:
    """Pull active campaigns + 30-day insights from the Meta Marketing API."""

    token = os.environ["META_ACCESS_TOKEN"]
    account = os.environ["META_AD_ACCOUNT_ID"].removeprefix("act_")
    base = f"https://graph.facebook.com/{META_API_VERSION}"

    with httpx.Client(timeout=timeout_seconds) as client:
        campaigns_resp = client.get(
            f"{base}/act_{account}/campaigns",
            params={
                "fields": "id,name,daily_budget,status",
                "effective_status": '["ACTIVE"]',
                "limit": 50,
                "access_token": token,
            },
        )
        campaigns_resp.raise_for_status()
        raw_campaigns = campaigns_resp.json().get("data", [])

        insights_resp = client.get(
            f"{base}/act_{account}/insights",
            params={
                "level": "campaign",
                "fields": "campaign_id,spend,actions,purchase_roas",
                "date_preset": "last_30d",
                "limit": 50,
                "access_token": token,
            },
        )
        insights_resp.raise_for_status()
        insights = {row.get("campaign_id"): row for row in insights_resp.json().get("data", [])}

    results: list[dict[str, Any]] = []
    for raw in raw_campaigns:
        row = insights.get(raw.get("id"), {})
        spend = int(float(row.get("spend", 0) or 0))
        conversions = 0
        for action in row.get("actions", []) or []:
            if action.get("action_type") in {"purchase", "lead", "complete_registration"}:
                conversions += int(float(action.get("value", 0) or 0))
        roas = 0.0
        for entry in row.get("purchase_roas", []) or []:
            roas = max(roas, float(entry.get("value", 0) or 0))
        # Meta reports daily_budget in the currency's minor units (paise).
        daily_budget = int(float(raw.get("daily_budget", 0) or 0)) // 100
        results.append(
            {
                "id": raw.get("id", ""),
                "name": raw.get("name", ""),
                "channel": "meta",
                "daily_budget": daily_budget,
                "spend_30d": spend,
                "results_30d": conversions,
                "cac": spend // conversions if conversions else 0,
                "roas": round(roas, 1),
            }
        )
    return results


def fetch_google_campaigns(timeout_seconds: float = 10.0) -> list[dict[str, Any]]:
    """Pull enabled campaigns + 30-day metrics from the Google Ads API."""

    developer_token = os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"]
    customer_id = os.environ["GOOGLE_ADS_CUSTOMER_ID"].replace("-", "")

    with httpx.Client(timeout=timeout_seconds) as client:
        token_resp = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "refresh_token",
                "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
                "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
                "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
            },
        )
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]

        headers = {
            "Authorization": f"Bearer {access_token}",
            "developer-token": developer_token,
        }
        login_customer = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")
        if login_customer:
            headers["login-customer-id"] = login_customer

        query = (
            "SELECT campaign.id, campaign.name, campaign_budget.amount_micros, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM campaign WHERE segments.date DURING LAST_30_DAYS "
            "AND campaign.status = 'ENABLED'"
        )
        search_resp = client.post(
            f"https://googleads.googleapis.com/{GOOGLE_ADS_API_VERSION}/customers/{customer_id}/googleAds:searchStream",
            headers=headers,
            json={"query": query},
        )
        search_resp.raise_for_status()
        batches = search_resp.json()

    results: list[dict[str, Any]] = []
    for batch in batches if isinstance(batches, list) else [batches]:
        for row in batch.get("results", []):
            campaign = row.get("campaign", {})
            budget = row.get("campaignBudget", {})
            metrics = row.get("metrics", {})
            spend = int(int(metrics.get("costMicros", 0) or 0) / 1_000_000)
            conversions = int(float(metrics.get("conversions", 0) or 0))
            conv_value = float(metrics.get("conversionsValue", 0) or 0)
            results.append(
                {
                    "id": str(campaign.get("id", "")),
                    "name": campaign.get("name", ""),
                    "channel": "google",
                    "daily_budget": int(int(budget.get("amountMicros", 0) or 0) / 1_000_000),
                    "spend_30d": spend,
                    "results_30d": conversions,
                    "cac": spend // conversions if conversions else 0,
                    "roas": round(conv_value / spend, 1) if spend else 0.0,
                }
            )
    return results


def resolve_campaigns(run_id: str | None = None, seed: int | str | None = None) -> CampaignSnapshot:
    """Return this run's campaign snapshot, preferring live data when configured."""

    live: list[dict[str, Any]] = []
    sources: list[str] = []
    notes: list[str] = []

    if _meta_configured():
        try:
            live.extend(fetch_meta_campaigns())
            sources.append("meta")
        except Exception as error:
            notes.append(f"meta fetch failed: {error}")
            logger.warning("data_sources.meta_fetch_failed", error=str(error))

    if _google_configured():
        try:
            live.extend(fetch_google_campaigns())
            sources.append("google")
        except Exception as error:
            notes.append(f"google fetch failed: {error}")
            logger.warning("data_sources.google_fetch_failed", error=str(error))

    if live:
        snapshot = CampaignSnapshot(
            campaigns=live,
            label=f"live-{'+'.join(sources)}",
            mode="live",
            notes=notes,
        )
    else:
        snapshot = CampaignSnapshot(
            campaigns=generate_synthetic_campaigns(seed),
            label=f"synthetic-session-{run_id or 'adhoc'}",
            mode="synthetic-fallback" if notes else "synthetic",
            notes=notes,
        )

    _persist_snapshot(snapshot)
    return snapshot


def _persist_snapshot(snapshot: CampaignSnapshot) -> None:
    """Best-effort write of the active snapshot for the web UI to display.

    Never allowed to fail a run: this is observability, not state.
    """

    try:
        repo_root = Path(__file__).resolve().parents[2]
        data_dir = repo_root / "web" / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "mode": snapshot.mode,
            "label": snapshot.label,
            "notes": snapshot.notes,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "campaigns": snapshot.campaigns,
        }
        (data_dir / "session-campaigns.json").write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )
    except Exception as error:
        logger.warning("data_sources.persist_failed", error=str(error))

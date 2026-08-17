# HELM — Agent Relay, Data Sources & Model Switching

**Session summary** · branch `varun` · repo `C:\Users\hp\Helm\HELM`
Tenant context: letstute / Finnovate — multi-tenant, SEBI-regulated financial-advisory marketing platform.

---

## 1. What was asked

The session moved through four phases, each triggered by a new request:

1. **Analyse only, no changes.** Review the codebase and produce a detailed instruction prompt for further development of the agent wiring (relay ↔ UI surfaces).
2. **Verify the relay is real.** Focus on the Governor and whether the Analyst, Creative and Media Buyer genuinely talk *through* it, dynamically. Also review the Google/Meta ads gateway skeletons.
3. **Fix it.** After finding that agent output was canned: "check the working of the ai agents esp the governor agent … and if the other agents [are] generating proper response or not and fix those issues."
4. **Build it out** (the main body of work):
   - A Python generator producing **synthetic data for each session run**.
   - Run on **both synthetic and live** data via **Meta and Google Ads**.
   - "I have also added the api key so just check and fix that so it runs and works fine."
   - Make API calls **very specific and thorough so it doesn't eat too much tokens/money**.
   - Add the ability to **switch between all available models in the UI** (Sonnet, Opus, and lower tiers).

---

## 2. System architecture (as verified)

### Governor star topology
LangGraph `StateGraph` with a star relay:

```
AN ↔ GV ↔ CR ↔ GV ↔ MB ↔ GV ↔ HITL
```

- Typed `HandoffEnvelope` per hop (from_agent, to_agent, hop_kind, summary, governor_rationale, verdict, payload).
- SQLite checkpointer + `interrupt()`-based human-in-the-loop gate.
- Durable resume through `AgentRuntime` — a run can be approved/rejected later and continues from the checkpoint.

**Conclusion:** the relay is structurally real. Hops are persisted (7 hops observed end-to-end), the HITL gate genuinely suspends and resumes.

### Gateway custody model
Workers hold **no** provider keys — enforced by `FORBIDDEN_CREDENTIAL_VARS` in `workers/helm_worker/config.py`. Every model call goes:

```
worker → HTTP → FastAPI gateway → adapter
```

Adapter is chosen at startup: `AnthropicAdapter` if `ANTHROPIC_API_KEY` is set, otherwise `ReplayAdapter` (canned fixtures). The active mode is surfaced on `/api/v1/health` as `gateway: "live" | "replay"`.

### Gateway pipeline
```
resolve policy → kill switch → reserve budget (integer micro-dollars)
→ adapter call → reconcile cost → record usage
```
The policy routing table (`TaskKind → TaskPolicy`) is the **single authority** for model, effort and max_tokens per task — call sites cannot override it.

---

## 3. Bugs found and fixed

| # | Bug | Impact | Fix |
|---|-----|--------|-----|
| 1 | `NameError: json is not defined` in `api/app/main.py` replay responder | Every replay-mode `/workspace/questions` call 500'd; the Governor's Analyst hop silently fell back to canned text | Added `import json` and `from typing import Any` |
| 2 | `analyst.answer` / `analyst.route` registered on the raw `/agents/completions` endpoint (added by a concurrent session) | Broke the security boundary — the analyst must stay behind `/workspace/questions` where citation verification runs | Removed both from `_AGENT_TASKS` in `api/app/api/v1/agents.py` |
| 3 | Replay citations always rejected (`grounded: false`) | Quotes were attributed to parent `##` sections while the text lived in `###` subsections; hard-coded citations couldn't survive retrieval variance across differently-phrased questions | Rewrote the replay responder to cite from the **actually supplied** `<document>` blocks parsed out of `system_volatile` |
| 4 | Frozen `SAMPLE_CAMPAIGNS` everywhere | Every run produced identical numbers — no session variance | Replaced with the new `data_sources` provider (§4) |
| 5 | 4 API tests + 7 web tests failing after the gateway/UI changes | — | Tests updated to the new policy-authority contract; both AgentConsole test mocks extended with the new actions |

### Citation verification (how it works now)
`AnalystService` retrieves the top-N corpus sections into `system_volatile` as:

```html
<document path="..." heading="..." lines="...">…</document>
```

Citations verify **only** against supplied sections: exact doc + heading match, and a whitespace-normalised substring match on the quote. The replay responder now parses those blocks with a nested `cite_supplied(keywords)` helper, ranks blocks by keyword relevance, quotes the first line longer than 20 chars, and returns up to 2 citations — guaranteeing `grounded: true` without hard-coding. The old fixed citations remain only as a fallback.

---

## 4. Synthetic + live data provider

**New file: `workers/helm_worker/data_sources.py`**

```python
CampaignSnapshot(campaigns, label, mode, notes)
```

### `generate_synthetic_campaigns(seed)`
Eight templates with **stable IDs** and per-run randomised metrics:

`fhc-meta-retargeting`, `fhc-meta-prospecting`, `search-brand`, `search-competitor`,
`whatsapp-nurture`, `pmax-tier1-wealth`, `youtube-explainer-video`, `email-lead-reengagement`

Randomisation: budgets ±30% (rounded to 500s), CAC ×0.80–1.25, ROAS ±0.6 (floor 0.8). Spend and results are **derived** so the numbers reconcile internally rather than contradicting each other.

### Live fetchers
- `fetch_meta_campaigns()` — Meta Graph API **v20.0**, campaigns + insights, paise → rupees (÷100).
- `fetch_google_campaigns()` — OAuth `refresh_token` grant → `googleAds:searchStream` GAQL, micros ÷ 1e6 (Google Ads REST **v17**).

### `resolve_campaigns(run_id, seed)`
Chooses live if the credentials are configured, otherwise synthetic; falls back to synthetic **with a note** if a live fetch fails.

| Mode | Meaning |
|------|---------|
| `live` | At least one provider returned real campaigns |
| `synthetic` | No credentials configured |
| `synthetic-fallback` | Credentials present but the fetch failed |

**Required env vars (worker process):**

```
META_ACCESS_TOKEN
META_AD_ACCOUNT_ID

GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
GOOGLE_ADS_CUSTOMER_ID
```

`_persist_snapshot` best-effort writes the active snapshot to `web/data/session-campaigns.json` for the UI.

### Wiring into the relay
- `agents/governor/state.py` — added `campaign_snapshot`, `data_label`, `data_mode` (required: LangGraph channels derive from the TypedDict annotations).
- `agents/governor/graph.py` — `init_run` calls `resolve_campaigns(run_id=run_id)`; the media package now derives `target_campaigns` from real IDs and `channel_priorities` from the top-3 by ROAS, with instructions naming the actual best/worst campaigns.
- `workers/helm_worker/__main__.py` — the standalone `buy` command uses the same provider and prints a mode-aware data label plus any fallback notes.

**Verified:** runs `gv-syn-a` and `gv-syn-b` produced different budgets/CAC/ROAS for the same campaign IDs; both completed the relay to `awaiting_approval` with 2 policy-clamped shifts.

---

## 5. Token thrift

Enforced **server-side in the gateway**, so no call site can overspend.

### Routing table re-pointed for cost
| Task | Model | Effort | max_tokens |
|------|-------|--------|-----------|
| `analyst.answer` | claude-sonnet-5 | MEDIUM | 4096 |
| `analyst.route` | claude-haiku-4-5 | LOW | 512 |
| `governor.plan` | claude-sonnet-5 | LOW | 1024 |
| `creative.variants` | claude-sonnet-5 | LOW | 2048 |
| `media_buyer.proposal` | claude-sonnet-5 | LOW | 2048 |

Sonnet 5 is $3/$15 per MTok vs Opus 5 at $5/$25.

### Hard clamps
`api/app/gateway/adapters/anthropic.py` — `_build_payload` now applies a three-way clamp and sends effort from the policy, not the caller:

```python
max_tokens = min(request.max_tokens, policy.default_max_tokens, capabilities.max_output_tokens)
output_config["effort"] = policy.default_effort.value
```

`api/app/gateway/service.py` mirrors the same clamp when reserving budget, so the reservation matches what is actually sent.

### Prompt-level thrift
- Analyst retrieval trimmed to `section_limit=6, token_budget=4_500` (was 8).
- Media Buyer now receives a **compact** `prompt_data`: objective, governor instructions, data label, and campaigns trimmed to `id / daily_budget / cac / roas / results_30d`. The creative deck is deliberately excluded.
- Tightened system prompt: "…using only their listed ids… each budget moves at most ±25%… fund every raise with cuts… Return JSON only."
- Snapshot-derived fallback shifts (best/worst by ROAS, `shift_amount = min(budgets) × 0.25`) so a model failure still yields a valid proposal.
- Prompt caching on the stable system prefix was already in place.

Side benefit: because the Media Buyer now sees the actual campaign table instead of a prose package, its proposals are markedly more specific.

**Safety note:** SEBI compliance checks and the ±25% budget policy engine (`apply_policy`) live in deterministic code — never delegated to the model.

---

## 6. Model switching (UI → API → gateway)

### API
`api/app/gateway/policy.py`:
- Added `claude-sonnet-5` to `CAPABILITIES` (effort + adaptive thinking, 128K output).
- New `ModelOption` dataclass and `AVAILABLE_MODELS` tuple (Opus 5, Sonnet 5, Haiku 4.5 — with labels, pricing, notes).
- Module-level `_model_override` with `set_model_override(model_id | None)` (raises `KeyError` on unknown) and `get_model_override()`.
- `resolve()` applies the override:

```python
if _model_override is not None and _model_override != policy.model.model:
    policy = replace(policy, model=ModelRef(provider=ANTHROPIC, model=_model_override))
return policy
```

`api/app/gateway/ratecard.py` — added the Sonnet 5 rate ($3 / $15 per MTok in micro-dollars).

`api/app/api/v1/agents.py` — new endpoints:

```python
GET  /api/v1/agents/models   -> ModelsOut(active, default_by_task, available[])
PUT  /api/v1/agents/models   -> SetModelIn(model: str | None)   # None clears the override
# UnknownModel(GatewayError) -> 422 "unknown_model"
```

`api/app/api/v1/health.py` — `HealthResponse` gained `gateway: str = "unknown"`, read from `request.app.state.gateway_mode`.

### Web
- `web/app/(app)/agents/actions.ts` — `ModelOption` / `ModelConfig` interfaces, `API_BASE` from `HELM_API_BASE_URL`, plus `getModelConfig()` and `setActiveModel(model)` with error-safe fallbacks.
- `web/app/(app)/agents/AgentConsole.tsx` — `modelConfig` / `switchingModel` state, config loaded on mount, `handleModelChange` mapping `'__default__' → null`; a `<select>` in `.agent-input-footer` listing "Auto (per-task default)" plus each model with its price, disabled while a run is in flight.
- `web/app/globals.css` — `.agent-model-picker` styles.

**Verified E2E:** curl `PUT {"model":"claude-haiku-4-5"}` → active; `{"model":null}` → cleared; `{"model":"gpt-4"}` → 422. In the browser, selecting "Claude Haiku 4.5" in the picker flipped the gateway override, then resetting to Auto cleared it.

**Caveat:** the override is in-memory — it resets to Auto when the API server restarts.

---

## 7. Ad-platform skeletons (reviewed, not modified)

`web/lib/server/ad-platforms/{index,meta-ads,google-ads}.ts` are sound skeletons. Two caveats before live use:

1. Fabricated resource IDs — `budget-${campaignId}` and `ag-${campaignId}` are constructed rather than looked up; real budget/ad-group resource names must be fetched.
2. Hard-coded `finalUrl` of `https://finnovate.in/fhc` should come from campaign config.

---

## 8. Open blocker

**`api/.env` contains `ANTHROPIC_API_KEY=` with an empty value.** It is the only occurrence in the repo, and the variable is not present in the shell environment either. That is why `/api/v1/health` still reports `"gateway": "replay"`.

I cannot insert the credential. To go live:

1. Open `api/.env` and paste the key after `ANTHROPIC_API_KEY=` (starts with `sk-ant-`).
2. Restart the API server.
3. Confirm:

```bash
curl http://localhost:8000/api/v1/health
```

It should report `"gateway": "live"`. Nothing else needs to change — `_install_analyst`'s `keys.has("anthropic")` check switches the adapter automatically at startup.

---

## 9. Test status

| Suite | Result |
|-------|--------|
| API (`api/tests`) | 237 passed |
| Workers (`workers/tests`) | 51 passed |
| Web (`web/test`) | 258 passed |

Notable test changes:
- `api/tests/test_gateway_adapter.py` — rewrote `test_effort_comes_from_the_policy_not_the_caller` (policy wins over the caller's requested effort), added `test_max_tokens_is_clamped_to_the_policy_cap`, model assertion now reads through `resolve(TaskKind.ANALYST_ANSWER).model.model`.
- `api/tests/test_health.py` — asserts `body["gateway"] in {"live", "replay"}`.
- `web/test/agent-star-relay.test.tsx` and `web/test/governor-wires.test.tsx` — mocks for `@/app/(app)/agents/actions` extended with `getModelConfig` / `setActiveModel`.

---

## 10. Files touched

**New**
- `workers/helm_worker/data_sources.py`
- `web/test/ad-platform-router.test.ts`

**Modified — API**
- `api/app/main.py`
- `api/app/api/v1/agents.py`
- `api/app/api/v1/health.py`
- `api/app/gateway/policy.py`
- `api/app/gateway/ratecard.py`
- `api/app/gateway/service.py`
- `api/app/gateway/adapters/anthropic.py`
- `api/tests/test_gateway_adapter.py`, `api/tests/test_health.py`

**Modified — Workers**
- `workers/helm_worker/__main__.py`
- `workers/helm_worker/config.py`
- `workers/helm_worker/gateway_client.py`
- `workers/helm_worker/agents/governor/{graph,state}.py`
- `workers/helm_worker/agents/{analyst,creative,media_buyer}/graph.py`
- `workers/tests/test_governor.py`

**Modified — Web**
- `web/app/(app)/agents/actions.ts`
- `web/app/(app)/agents/AgentConsole.tsx`
- `web/app/globals.css`
- `web/lib/server/agent-runner.ts`
- `web/lib/server/ad-platforms/{index,meta-ads,google-ads}.ts`
- `web/test/{agent-star-relay,governor-wires,studio}.test.tsx`

---

## 11. Verification commands

Run a Governor mission end-to-end from the CLI:

```bash
python -m helm_worker govern "Grow the ₹999 Financial Health Checkup" --run-id gv-demo --json
```

Approve the pending HITL gate:

```bash
python -m helm_worker decide gv-demo --approve
```

Inspect the persisted relay hops:

```bash
curl http://localhost:8000/api/v1/agents/runs/gv-demo/steps
```

Check which model the gateway is currently pinned to:

```bash
curl http://localhost:8000/api/v1/agents/models
```

---

## 12. Environment notes

- Windows 11, PowerShell 5.1: `??` (null-coalescing) is a parser error — use `if` / `-not`. Virtualenv paths are relative, so `Set-Location` into `workers/` or `api/` before invoking `.venv`.
- `uvicorn` runs without `--reload`, so config or code changes require killing the process and restarting; stale processes occasionally rebind port 8000 and cause an "address in use" exit.
- Credential values must never be read or printed — only masked/length-free checks.

# HELM Frontend Prototype — Design Spec

> **Status:** Approved design (v1 of the prototype sub-project)
> **Date:** 2026-07-18
> **Author:** Aniket + Claude Code
> **Parent spec:** `HELM_ARCHITECTURE.md` (the full platform build spec)
> **Canonical visual reference:** `helm-mockup-v4.html` (interactive, at repo root)

---

## 1. Context & why this is scoped as it is

HELM (per `HELM_ARCHITECTURE.md`) is a multi-tenant marketing-operations control plane made of **nine independent subsystems** — tenancy/auth, model gateway, LLM workspace, MCP integrations, analytics, agent runtime, creative subsystem, custom ML, and hardening. That is a multi-quarter build; it cannot be "fully developed" in one pass, and it should not be attempted as one spec.

We decomposed it. **This spec covers the first sub-project only: the frontend prototype** — the complete HELM UI shell running on realistic mock data behind a clean, swappable data layer. It exists to:

1. Validate the information design and UX before any backend is built.
2. Give a real, clickable product to demo this week.
3. Become the shell every backend subsystem later plugs into, so the work is foundational, not throwaway.

Each remaining subsystem gets its own spec → plan → implementation cycle later.

## 2. Goals & non-goals

**Goals**
- A polished, data-dense, gen-z-modern UI covering the core HELM surfaces.
- A **Master Console** (platform-admin layer) navigable from the sidebar: agent fleet, model gateway, training/evals, RBAC, system config.
- Multi-level RBAC reflected in navigation and the permission matrix (Master Admin = root, at the top of every scope).
- Dark-first theming with a proper light theme; instant, legible data visualization where every data point's color and direction carry consistent meaning.
- A typed data-access layer (`lib/data`) so mock fixtures can be swapped for the real BFF without touching UI code.

**Non-goals (explicitly deferred to later sub-projects)**
- No real backend, database, auth, or model calls. All data is mock.
- No live MCP integrations, no real agent runtime, no real generation.
- No billing, no real multi-tenant isolation (tenant switching is UI-only here).
- Real-time streaming, websockets, and true retrieval are simulated, not implemented.

## 3. Approved visual direction

Derived from five reference shots the user selected (STEALTH agent-monitor, TalentIQ, AIRecruit360, Atomie, Cognivo) and the user's explicit feedback across four mockup iterations. Final direction (v4):

- **Typography:** **Open Sans** throughout (400–800), tabular-lining numerals. No display or monospace mixing — clean and simple by explicit request.
- **Theme:** **dark-first** + light, via CSS custom properties on `:root` / `html[data-theme]`. Dark is a cohesive neutral slate (page → sidebar → card → card-2 elevation steps), **not** a colored slab.
- **Accent:** **violet** (`#8b5cf6`) as the single primary accent (active nav, buttons, highlights) + **emerald** (`#34d399`) as the "live / positive" signal. Semantic: emerald = good/up, rose = bad/over, amber = caution. A data palette (violet, sky, emerald, amber, rose) is used sparingly and consistently — a color always means the same thing.
- **Sidebar:** neutral dark/light panel; violet appears only as accent on the active item. (The earlier purple-slab sidebar was rejected for failing in dark mode.)
- **Shape:** cards at 16px radius; **all buttons, controls, pills, and inputs are full pills** (`border-radius: 999px`) by explicit request.
- **Icons:** consistent Lucide-style line icons — 24 viewBox, ~1.75 stroke, rounded caps/joins.
- **Form language:** bento grid, glass/elevation for depth (subtle, not noisy), KPI tiles with area-fill sparklines, a right-side Live Activity rail, radial goal gauges, a performance heatmap, and inline "AI insight" chips.

## 4. Architecture

**Stack (dictated by `HELM_ARCHITECTURE.md` §12):** Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui, deploy-ready for Vercel. Theming via CSS variables + shadcn tokens.

**Load-bearing principle — the swappable data layer.** Every screen reads through a typed service module, never from fixtures directly:

```
lib/
  types.ts        // canonical entities mirroring HELM_ARCHITECTURE §11
  data/
    index.ts      // service interface: getDashboardMetrics(tenantId), listCampaigns(tenantId), ...
    mock/         // realistic, internally-consistent fixtures
    format.ts     // ₹ / % / K-L-Cr Indian number formatting, delta helpers
  tenant.tsx      // TenantProvider (client) — shaped to become the signed server context later
  rbac.ts         // role → capability map; gates nav + actions
```

- **Canonical types** mirror the §11 data model: `Tenant, User, Role, Campaign, AdGroup, Creative, Contact, Conversion, Touch, AgentRun, Approval, UsageEvent, Integration`. Mock data is shaped like real data.
- **Swap path:** when a backend arrives, only `lib/data/*` changes to call the BFF; screens are untouched.
- **Tenant context** is a client provider now (top-bar switcher), shaped to become the signed, immutable server context object later.
- **RBAC:** a `role → capabilities` map drives which nav items and actions render. Master Admin sees everything including the Master Console; lower roles see a subset.
- **Mock realism:** funnel totals reconcile with the channel and campaign tables; CAC/ROAS/LTV math is real; dates plausible. Charts tell a coherent story.

## 5. Navigation & routing

Sidebar-routed (no top tabs). Two sections, RBAC-gated:

**Operate** (all roles, scoped)
- Analytics · Campaigns · Creative Studio · Workspace · Integrations · Approvals

**Master Console** (Master Admin / platform-admin only)
- Agent Fleet · Model Gateway · Training & Evals · Access & RBAC · System Config

App shell: left sidebar (brand, tenant switcher, role chip, nav, user), top bar (search, live indicator, theme toggle, notifications, primary action). Responsive: sidebar → icon rail → drawer; bento columns collapse to single column under ~1240px.

## 6. Surface specifications

### 6.1 Analytics (home)
KPI hero (CAC, Checkups, ROAS, Spend) with area-fill sparklines; a **16-cell metric strip** (Impressions, Reach, Frequency, CTR, CPC, CPM, Lead CVR, Quality, AOV, LTV, LTV:CAC, Payback, CPL, Reply Rate, Advisory, SEBI blocks); Spend·Revenue·Checkups multi-series chart **with 7-day forecast** and an AI-insight chip; a **Live Activity rail** (per-event latency/tokens/status with ERR/REVIEW tags); Conversion Funnel with stage conversion %; Channel Mix (split bar + table); Goal-attainment radial gauges; Performance Heatmap (day × hour); Creative Leaderboard; Approvals preview.

### 6.2 Campaigns
List (filter/sort, status pills, budget pacing) → detail (ad groups, creatives, day-by-day performance). *Placeholder in prototype v1; wired nav slot.*

### 6.3 Creative Studio
Brief → generate (image/video/copy, mocked) → variants gallery → SEBI compliance gate badge → ship; performance chips on shipped creatives. *Placeholder in prototype v1.*

### 6.4 Workspace (embedded LLM)
Model-select chat routed "via Gateway"; grounded-retrieval toggle with mock citations; prompt library; file upload; airy Cognivo-style hero. *Placeholder in prototype v1.*

### 6.5 Integrations & Approvals
Integrations: connect/health/scopes for MCP servers. Approvals: HITL inbox — approve/edit/reject, agent resumes from checkpoint. *Placeholders; live integration health also shown under System Config.*

### 6.6 Master Console (built in prototype v1)
- **Agent Fleet** — global kill switch + 8 LangGraph agents (autonomy tier AUTO/PROPOSE/HUMAN-VETO, runs, success, tokens, cost, per-agent toggle).
- **Model Gateway** — provider budgets, logical-task routing table, model split, gateway guardrails (cache, rate limits, failover).
- **Training & Evals** — jobs/models table, eval leaderboard.
- **Access & RBAC** — permission matrix (roles × capabilities) + team members.
- **System Config** — guardrails (injection, PII, SEBI, grounding, safety), feature flags, integration health.

## 7. Design-system components

Reusable, theme-aware, used everywhere: `AppShell`, `Sidebar`, `TopBar`, `TenantSwitcher`, `ThemeToggle`, `StatTile` (with sparkline), `MetricStripCell`, `DeltaBadge`, `TrendChart`, `FunnelChart`, `SplitBar`, `RadialGauge`, `Heatmap`, `DataTable`, `StatusPill`, `Toggle`, `PermissionMatrix`, `AgentCard`, `LiveActivityRail`, `AIInsightChip`, `Pill`, `Button` (pill), `EmptyState`.

**Dataviz rules:** every metric shows label + value + unit + directional delta; one shared chart palette valid in both themes and colorblind-safe; no chart without axis/labels/tooltip; consistent ₹ / % / K-L-Cr formatting; semantic colors reserved (green up/good, red down/over, amber caution) so lower-is-better metrics (CAC ▼) still read green.

## 8. Success criteria

- All Operate + Master Console nav items route from the sidebar; Master Console gated to Master Admin.
- Dark and light themes both polished; toggle works; no contrast failures (≥4.5:1 body text).
- Every screen reads through `lib/data`; zero direct fixture imports in components.
- Mock numbers reconcile across funnel, channel, and campaign views.
- Analytics + all five Master Console pages fully built; Operate sub-pages have wired placeholders.
- Responsive at 375 / 768 / 1024 / 1440 with no horizontal scroll.
- Buttons/controls are pills; Open Sans throughout; Lucide-style icons.

## 9. Reference lineage
STEALTH (dark agent-monitor spine, live rail, area sparklines) · TalentIQ (radial gauges) · AIRecruit360 (dense-but-calm tables, AI chips) · Atomie (single-accent restraint) · Cognivo (airy workspace hero). Synthesized against `ui-ux-pro-max` design intelligence and 2026 AI-platform trends (bento, dark-first, refined glass).

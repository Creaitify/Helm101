# HELM Operate Surfaces — Design Spec

> **Status:** Approved design (sub-project 2 of the HELM build)
> **Date:** 2026-07-18
> **Parent specs:** `HELM_ARCHITECTURE.md` (§6.2–6.5, §7, §8.3, §9) · `2026-07-18-helm-frontend-prototype-design.md` (sub-project 1, complete)
> **Builds on:** the merged frontend prototype (`helm-app/`, on `main`)

---

## 1. Context & scope

Sub-project 1 delivered the HELM shell: the Analytics console and all five Master Console pages, with the five **Operate** surfaces wired as routed `EmptyState` placeholders. This sub-project replaces those five placeholders with real, interactive screens — still on **mock data behind the existing `@/lib/data` seam**, no backend or model calls.

**In scope:** Campaigns (list + detail), Creative Studio (brief → generate → ship), LLM Workspace (chat + prompt library), Approvals Inbox (HITL decisions), Integrations (connector management).

**Out of scope (unchanged from sub-project 1):** real backend/DB/auth, real MCP integrations, real model/generation calls, persistence across reloads. All "live" behavior is simulated with local React state + `setTimeout`. Each remaining backend subsystem is a later sub-project.

## 2. Goals & non-goals

**Goals**
- Every Operate nav item opens a real, clickable screen that exercises its core flow.
- Interactions feel real: filtering, drawers, approve/reject, simulated generation, streamed chat, connect toggles.
- All data flows through `@/lib/data` (extended); components never import fixtures directly.
- Visual system unchanged: Open Sans, dark-first + light, violet/emerald accents, pill controls, CSS-variable tokens, lucide icons — matching the established look.

**Non-goals**
- No real async I/O, network, model, or persistence. Interaction state resets on reload (explicitly chosen).
- No new npm dependencies.
- No redesign of the shell, Analytics, or Master Console.

## 3. Architecture

**Server-fetch → client-interact.** Each surface's `page.tsx` stays an async server component that `await`s initial data from `@/lib/data` and passes it as props to a client `*View` component (`'use client'`) that owns interaction state. This preserves the server-side data seam while keeping interactivity on the client.

**Data layer extension.** Add types to `lib/types.ts` and fixtures + service functions to `lib/data` (mock module + `index.ts`). New service functions follow the existing async-returning-Promise pattern (the swap seam a real BFF later implements). Reuse existing types (`Campaign`, `Creative`, `Agent`, `IntegrationRow`, etc.) and extend rather than duplicate.

**Simulated async.** Loading/streaming states use `setTimeout`; e.g. "generating…" resolves to mock variants after ~1.2s; a chat reply streams token-by-token via an interval. No timers leak (cleared on unmount).

**Interactivity boundaries.** Small, focused client components; each surface's `*View` holds only its own state. Cross-surface signals (e.g. the Approvals badge count) are handled with a lightweight client context so the sidebar badge reflects decisions within a session.

## 4. Surface specifications

### 4.1 Campaigns (`/campaigns`)
- **List:** all campaigns (extend beyond the 5 summary rows) in a `DataTable`/card list with a `FilterBar` (status, channel, text search) and sortable columns: name, channel, status pill, spend, budget-pacing bar, results, CAC, ROAS.
- **Detail:** clicking a row opens a `SlideOver` drawer showing the campaign header (objective, budget, status, dates), an **ad-groups** list, a **creatives** grid (thumbnails + status), and a **day-by-day performance** chart. Closeable; one open at a time.
- **Data:** `getCampaignsFull()`, `getCampaignDetail(id)` → `{ campaign, adGroups, creatives, series }`.

### 4.2 Creative Studio (`/studio`)
- **Brief form:** audience, hook, offer, and format (image / video / copy) inputs → "Generate".
- **Generate:** simulated *generating…* state (skeleton cards) → resolves to a **variants gallery**. Image variants render as branded gradient placeholders with the brief's headline; copy variants render as text cards.
- **Compliance gate:** each variant shows a **SEBI badge** — `pass` or `flag` (with reason). Flagged variants cannot be shipped until acknowledged.
- **Ship:** "Ship" moves a variant into a **Shipped** strip with a mock performance chip (e.g. CAC). 
- **Data:** `getBriefDefaults()`, `generateVariants(brief)` (returns mock variants after a delay).

### 4.3 LLM Workspace (`/workspace`)
- **Layout:** prompt-library sidebar + chat column (Cognivo-style airy hero on empty state).
- **Model selector:** pills for Claude / GPT / Gemini labeled "via Gateway" (selection is cosmetic).
- **Chat:** user message → **canned streamed reply** (typewriter via interval) with 1–3 **citation chips** referencing mock tenant data (e.g. "Campaign: FHC Retargeting"). A grounded-context toggle shows/hides citations.
- **Prompt library:** clickable saved templates (ad brief, audience analysis, reply drafting, report) that insert text into the input.
- **File attach:** mock — selecting a file shows an attached chip; no upload.
- **Data:** `getPromptTemplates()`, `getWorkspaceGreeting()`, plus a local canned-response generator keyed loosely to the prompt.

### 4.4 Approvals Inbox (`/approvals`)
- **Pending list:** agent proposals (`ApprovalItem`: agent, action, payload summary, proposed-at, policy checks). Each row has **Approve / Edit / Reject**.
- **Detail panel:** selecting an item shows full payload + policy-check list.
- **Decide:** Approve/Reject removes the item from Pending, appends it to a **Decided** tab (with outcome + timestamp), fires a `Toast`, and **decrements the sidebar Approvals badge** via the shared client context. Edit opens the payload for a mock tweak before approving.
- **Data:** `getApprovals()` → pending `ApprovalItem[]`.

### 4.5 Integrations (`/integrations`)
- **Connector grid:** `IntegrationCard` per platform (Meta, Google Ads, GA4, WhatsApp/BSP, Instantly, Mailchimp, n8n) plus an "available to add" set. Each shows icon, status (`healthy` / `degraded` / `paused` / `disconnected`), auth type (OAuth 2.1 / API key / token), scopes, last-sync, calls/24h.
- **Actions:** a simulated **connect/disconnect** toggle flips status (disconnected ⇄ healthy); a health/detail expansion shows scopes + recent activity.
- **Data:** `getIntegrationsFull()` → richer `IntegrationDetail[]` (extends `IntegrationRow`).

## 5. New components

`SlideOver` (drawer), `Tabs`, `Toast`/`ToastProvider`, `FilterBar`, `ChatThread` + `ChatMessage`, `VariantCard`, `BriefForm`, `ApprovalCard`, `IntegrationCard`, and a small `ApprovalsProvider` (client context for the badge count). Reuse `Card`, `Button`, `Pill`, `StatusPill`, `Toggle`, `DeltaBadge`, `DataTable`, `TrendChart`, `EmptyState`. All theme-aware via existing CSS variables; any new CSS classes are added to `globals.css` in the same idiom.

## 6. Testing

Vitest + React Testing Library behavior tests per surface:
- Campaigns: filter narrows the list; row click opens the drawer with the right detail; sort reorders.
- Studio: submitting the brief shows the generating state, then variants; a `flag` variant blocks Ship until acknowledged; Ship moves it to Shipped.
- Workspace: sending a message appends the user message and a reply; prompt-template click inserts text; grounded toggle shows/hides citations.
- Approvals: Approve removes the item, adds it to Decided, and decrements the badge; Reject likewise.
- Integrations: connect toggles status disconnected→healthy.
Plus `tsc --noEmit` clean and `npm run build` green on every task. Executed via subagent-driven development, task-by-task with reviews.

## 7. Success criteria
- All five Operate routes render real interactive screens (no `EmptyState` placeholders remain).
- Each surface's core flow works with simulated async; no timer leaks; state resets on reload.
- Zero direct fixture imports in components; all data via `@/lib/data`.
- Dark + light both correct; responsive to the existing breakpoints; icon-only controls have `aria-label`s.
- Full suite passes; `tsc` clean; production build green.

## 8. Reference lineage
Cognivo (Workspace hero + chat), AIRecruit360 (dense tables, AI chips, candidate-style cards), Atomie (workflow/inspector drawer), STEALTH/TalentIQ (status + score treatments) — same five shots that anchored sub-project 1.

# HELM Operate Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five Operate placeholder pages (Campaigns, Creative Studio, LLM Workspace, Approvals, Integrations) with real, interactive screens driven by mock data through the existing `@/lib/data` seam — no backend or model calls.

**Architecture:** Each surface's `page.tsx` stays an async server component that `await`s initial data from `@/lib/data` and passes it to a client `*View` component (`'use client'`) that owns interaction state. Simulated async uses `setTimeout`/intervals (cleared on unmount). Shared new primitives (SlideOver, Tabs, Toast, FilterBar) and a client `ApprovalsProvider` (for the live sidebar badge) support the surfaces. New CSS is appended to `helm-app/app/globals.css` in the established CSS-variable idiom (there is no v4 mockup for these surfaces).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest + React Testing Library, lucide-react. No new dependencies.

## Global Constraints

- **App lives in `helm-app/`.** Run all npm commands from there; run git from repo root `C:/Users/anike/Desktop/HELM`.
- **Next 16 caveat:** `helm-app/AGENTS.md` warns App Router APIs may differ from older Next. Async server components that `await` data are supported. If an App Router API misbehaves, consult `helm-app/node_modules/next/dist/docs/`.
- **Data discipline:** components read data ONLY through `@/lib/data` — never import `lib/data/mock/fixtures` in a component. Pure client-side mock helpers (variant generation, canned chat) are allowed and live in `lib/`.
- **No new npm dependencies.**
- **Visual system:** Open Sans (already wired); dark-first + light via CSS variables — NEVER hardcode hex in components, use existing tokens (`--violet`, `--emerald`, `--sky`, `--amber`, `--rose`, `--card`, `--line`, `--text`, `--dim`, `--faint`, etc.). Cards `border-radius:16px` (`--radius`); all buttons/controls full pills (`--pill:999px`). Icons: lucide-react only, ~1.75 stroke.
- **Server→client pattern:** `page.tsx` is a server component; interactivity lives in a `'use client'` `*View`. Tests render the `*View` directly with props (do not render the async page in interaction tests).
- **No timer leaks:** every `setTimeout`/`setInterval` is cleared in a `useEffect` cleanup or on the resolving callback.
- **State resets on reload** (no persistence) — this is intended.
- **Commits:** conventional messages, one per task, ending with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Every task ends green: `npm test` (all pass), `npx tsc --noEmit` (clean). Surface tasks (5–9) also run `npm run build`.

## Existing building blocks (reuse — do not re-implement)
- `@/components/ui`: `Button` (`variant?:'primary'|'ghost'`), `Pill` (`variant?:'v'|'e'|'r'`), `StatusPill`, `Toggle`, `DeltaBadge`, `Card` (`className?`, `style?`), `EmptyState`, `SegControl`.
- `@/components/viz`: `Sparkline`, `StatTile`, `RadialGauge`, `FunnelChart`, `SplitBar`, `Heatmap`, `DataTable` (`columns:{key,label,align?,render?}[]`, `rows:any[]`), `LiveActivityRail`, `AIInsightChip`, `AgentCard`, `PermissionMatrix`, `TrendChart`.
- `@/lib/format`: `inr`, `compact`, `pct`, `deltaDirection`.
- `@/lib/types`, `@/lib/data`, `@/lib/tenant`, `@/lib/theme`, `@/lib/rbac`, `@/lib/nav`.

---

## File Structure

```
helm-app/
  lib/
    types.ts                    # + new interfaces (Task 1)
    data/index.ts               # + new service fns (Task 1)
    data/mock/fixtures.ts       # + new fixtures (Task 1)
    approvals.tsx               # ApprovalsProvider + useApprovals (Task 3)
  components/
    ui/SlideOver.tsx            # Task 2
    ui/Tabs.tsx                 # Task 2
    ui/Toast.tsx                # ToastProvider + useToast (Task 2)
    ui/FilterBar.tsx            # FilterBar + Select + SearchInput (Task 2)
    ui/Toggle.tsx               # + onClick (Task 2)
    ui/StatusPill.tsx           # + new statuses (Task 2)
  app/(app)/layout.tsx          # wrap providers (Task 3)
  components/shell/Sidebar.tsx  # dynamic approvals badge (Task 3)
  app/(app)/campaigns/page.tsx  + campaigns/CampaignsView.tsx   (Task 4)
  app/(app)/studio/page.tsx     + studio/StudioView.tsx  + lib/studio.ts   (Task 5)
  app/(app)/workspace/page.tsx  + workspace/WorkspaceView.tsx + lib/workspace.ts (Task 6)
  app/(app)/approvals/page.tsx  + approvals/ApprovalsView.tsx  (Task 7)
  app/(app)/integrations/page.tsx + integrations/IntegrationsView.tsx (Task 8)
```

---

### Task 1: Data layer extension (types + fixtures + service)

**Files:**
- Modify: `helm-app/lib/types.ts` (append)
- Modify: `helm-app/lib/data/mock/fixtures.ts` (append)
- Modify: `helm-app/lib/data/index.ts` (append)
- Test: `helm-app/test/operate-data.test.ts`

**Interfaces:**
- Produces types: `CampaignFull, AdGroup, CreativeAsset, CampaignDetail, Brief, VariantKind, Variant, PromptTemplate, Citation, ChatMessage, PolicyCheck, ApprovalItem, IntegrationDetail`.
- Produces service fns: `getCampaignsFull(): Promise<CampaignFull[]>`, `getCampaignDetail(id: string): Promise<CampaignDetail>`, `getBriefDefaults(): Promise<Brief>`, `getPromptTemplates(): Promise<PromptTemplate[]>`, `getApprovals(): Promise<ApprovalItem[]>`, `getIntegrationsFull(): Promise<IntegrationDetail[]>`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/operate-data.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as data from '@/lib/data'

describe('operate data', () => {
  it('campaign detail resolves for a known id', async () => {
    const list = await data.getCampaignsFull()
    expect(list.length).toBeGreaterThanOrEqual(6)
    const detail = await data.getCampaignDetail(list[0].id)
    expect(detail.campaign.id).toBe(list[0].id)
    expect(detail.adGroups.length).toBeGreaterThan(0)
    expect(detail.series.length).toBe(14)
  })
  it('exposes approvals, prompts, integrations', async () => {
    expect((await data.getApprovals()).length).toBe(3)
    expect((await data.getPromptTemplates()).length).toBeGreaterThanOrEqual(4)
    const ints = await data.getIntegrationsFull()
    expect(ints.some((i) => i.status === 'disconnected')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- operate-data`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Append the types**

Append to `helm-app/lib/types.ts`:
```ts
export interface CampaignFull {
  id: string; name: string; channel: string; channelColor: SeriesColor
  status: 'active' | 'review' | 'paused'
  spend: number; budget: number; pacingPct: number
  results: number; cac: number | null; roas: number
  objective: string; startedAt: string
}
export interface AdGroup { id: string; name: string; status: 'active' | 'paused'; spend: number; results: number }
export interface CreativeAsset { id: string; kind: 'image' | 'video' | 'copy'; label: string; status: 'live' | 'review' | 'draft'; grad: [SeriesColor, SeriesColor] }
export interface CampaignDetail { campaign: CampaignFull; adGroups: AdGroup[]; creatives: CreativeAsset[]; series: number[] }

export type VariantKind = 'image' | 'copy'
export interface Brief { audience: string; hook: string; offer: string; format: 'image' | 'video' | 'copy' }
export interface Variant { id: string; kind: VariantKind; headline: string; body?: string; grad: [SeriesColor, SeriesColor]; compliance: 'pass' | 'flag'; flagReason?: string }

export interface PromptTemplate { id: string; title: string; body: string }
export interface Citation { label: string; source: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; citations?: Citation[] }

export interface PolicyCheck { label: string; status: 'pass' | 'warn' }
export interface ApprovalItem { id: string; agent: string; agentCode: string; action: string; summary: string; payload: string; proposedAt: string; checks: PolicyCheck[] }

export interface IntegrationDetail {
  id: string; name: string; auth: 'OAuth 2.1' | 'API key' | 'token'
  status: 'healthy' | 'degraded' | 'paused' | 'disconnected'
  scopes: string[]; lastSync: string; calls: string; grad: [SeriesColor, SeriesColor]
}
```

- [ ] **Step 4: Append the fixtures**

Append to `helm-app/lib/data/mock/fixtures.ts` (import the new types at the top's existing type import). Use realistic, self-consistent values:
```ts
export const campaignsFull: import('../../types').CampaignFull[] = [
  { id: 'c1', name: 'FHC · Retargeting', channel: 'Meta', channelColor: 'violet', status: 'active', spend: 156000, budget: 230000, pacingPct: 68, results: 458, cac: 341, roas: 3.2, objective: 'Lowest CAC / checkup', startedAt: '2026-06-18' },
  { id: 'c2', name: 'FHC · Lookalike 2%', channel: 'Meta', channelColor: 'violet', status: 'active', spend: 92000, budget: 100000, pacingPct: 92, results: 202, cac: 455, roas: 2.5, objective: 'Scale prospecting', startedAt: '2026-06-25' },
  { id: 'c3', name: 'Search · Brand', channel: 'Google', channelColor: 'amber', status: 'active', spend: 54000, budget: 100000, pacingPct: 54, results: 181, cac: 298, roas: 3.4, objective: 'Capture intent', startedAt: '2026-05-30' },
  { id: 'c4', name: 'Reels · Awareness', channel: 'Meta', channelColor: 'violet', status: 'review', cac: null, spend: 0, budget: 80000, pacingPct: 0, results: 0, roas: 0, objective: 'Top-of-funnel reach', startedAt: '2026-07-15' },
  { id: 'c5', name: 'FHC · Prospecting', channel: 'Google', channelColor: 'amber', status: 'active', spend: 83000, budget: 80000, pacingPct: 104, results: 136, cac: 612, roas: 1.9, objective: 'Volume', startedAt: '2026-06-10' },
  { id: 'c6', name: 'Email · Nurture', channel: 'Email', channelColor: 'sky', status: 'paused', spend: 7000, budget: 35000, pacingPct: 20, results: 63, cac: 556, roas: 1.9, objective: 'Reactivate leads', startedAt: '2026-05-20' },
  { id: 'c7', name: 'WhatsApp · Reminder', channel: 'WhatsApp', channelColor: 'emerald', status: 'active', spend: 41000, budget: 52000, pacingPct: 79, results: 128, cac: 406, roas: 3.1, objective: 'Abandoned checkout', startedAt: '2026-06-05' },
  { id: 'c8', name: 'Search · Competitor', channel: 'Google', channelColor: 'amber', status: 'paused', spend: 22000, budget: 40000, pacingPct: 55, results: 40, cac: 550, roas: 1.7, objective: 'Conquesting', startedAt: '2026-06-28' },
]
const AD_GROUPS: import('../../types').AdGroup[] = [
  { id: 'ag1', name: 'Age 30–45 · Metro', status: 'active', spend: 78000, results: 240 },
  { id: 'ag2', name: 'Age 45–60 · Metro', status: 'active', spend: 54000, results: 150 },
  { id: 'ag3', name: 'Retarget · 7d site', status: 'paused', spend: 24000, results: 68 },
]
const CREATIVE_ASSETS: import('../../types').CreativeAsset[] = [
  { id: 'cr1', kind: 'video', label: '"Retire at 50" · Reel', status: 'live', grad: ['violet', 'sky'] },
  { id: 'cr2', kind: 'image', label: '"₹999 = clarity" · Static', status: 'live', grad: ['sky', 'emerald'] },
  { id: 'cr3', kind: 'image', label: '"Tax season" · Carousel', status: 'review', grad: ['amber', 'rose'] },
  { id: 'cr4', kind: 'copy', label: 'Primary text · v3', status: 'draft', grad: ['violet', 'rose'] },
]
export function campaignDetail(id: string): import('../../types').CampaignDetail {
  const campaign = campaignsFull.find((c) => c.id === id) ?? campaignsFull[0]
  const series = [22, 26, 24, 30, 28, 34, 33, 38, 36, 41, 40, 44, 43, 48]
  return { campaign, adGroups: AD_GROUPS, creatives: CREATIVE_ASSETS, series }
}
export const briefDefaults: import('../../types').Brief = { audience: 'Salaried professionals, 30–45, metros', hook: 'Financial clarity in 20 minutes', offer: '₹999 Financial Health Checkup', format: 'image' }
export const promptTemplates: import('../../types').PromptTemplate[] = [
  { id: 'p1', title: 'Ad brief', body: 'Write a Meta ad brief for the ₹999 Financial Health Checkup targeting ' },
  { id: 'p2', title: 'Audience analysis', body: 'Analyse the top-converting audience segment for the last 30 days and suggest ' },
  { id: 'p3', title: 'Reply drafting', body: 'Draft a WhatsApp reply to a lead who asked about ' },
  { id: 'p4', title: 'Report writing', body: 'Write a weekly performance summary for Finnovate covering CAC, checkups and ' },
]
export const approvals: import('../../types').ApprovalItem[] = [
  { id: 'a1', agent: 'Media Buyer', agentCode: 'MB', action: 'Budget shift', summary: '+₹15K to Lookalike 2%', payload: 'Move ₹15,000/day from FHC · Prospecting (CAC ₹612) to FHC · Lookalike 2% (CAC ₹455).', proposedAt: '14:02', checks: [{ label: 'Within daily cap', status: 'pass' }, { label: 'CAC guardrail', status: 'pass' }, { label: 'Pacing > 90%', status: 'warn' }] },
  { id: 'a2', agent: 'Creative', agentCode: 'CR', action: 'Ship creative', summary: 'Ship 4 new reels', payload: 'Publish 4 reel variants (V-14…V-17) to Reels · Awareness. All passed the SEBI compliance gate.', proposedAt: '13:30', checks: [{ label: 'SEBI compliance', status: 'pass' }, { label: 'Brand lock', status: 'pass' }] },
  { id: 'a3', agent: 'Audience', agentCode: 'AU', action: 'Suppression list', summary: 'New suppression list', payload: 'Suppress 1,240 contacts who opted out in the last 24h across Meta + WhatsApp.', proposedAt: '11:15', checks: [{ label: 'Consent / DPDP', status: 'pass' }, { label: 'Hashed PII only', status: 'pass' }] },
]
export const integrationsFull: import('../../types').IntegrationDetail[] = [
  { id: 'i1', name: 'Meta Ads', auth: 'OAuth 2.1', status: 'healthy', scopes: ['ads_read', 'ads_management'], lastSync: '2m ago', calls: '3,412', grad: ['violet', 'sky'] },
  { id: 'i2', name: 'Google Ads', auth: 'OAuth 2.1', status: 'healthy', scopes: ['adwords'], lastSync: '1m ago', calls: '2,180', grad: ['amber', 'rose'] },
  { id: 'i3', name: 'GA4', auth: 'OAuth 2.1', status: 'healthy', scopes: ['analytics.readonly'], lastSync: '4m ago', calls: '1,024', grad: ['sky', 'emerald'] },
  { id: 'i4', name: 'WhatsApp / BSP', auth: 'API key', status: 'degraded', scopes: ['messages', 'templates'], lastSync: '18m ago', calls: '642', grad: ['emerald', 'sky'] },
  { id: 'i5', name: 'Instantly', auth: 'API key', status: 'healthy', scopes: ['campaigns', 'inbox'], lastSync: '3m ago', calls: '918', grad: ['violet', 'emerald'] },
  { id: 'i6', name: 'Mailchimp', auth: 'OAuth 2.1', status: 'healthy', scopes: ['audiences', 'campaigns'], lastSync: '6m ago', calls: '204', grad: ['amber', 'violet'] },
  { id: 'i7', name: 'n8n', auth: 'token', status: 'paused', scopes: ['workflows'], lastSync: '2h ago', calls: '0', grad: ['rose', 'amber'] },
  { id: 'i8', name: 'Segment', auth: 'API key', status: 'disconnected', scopes: [], lastSync: '—', calls: '0', grad: ['sky', 'violet'] },
]
```

- [ ] **Step 5: Append the service functions**

Append to `helm-app/lib/data/index.ts`:
```ts
export const getCampaignsFull = () => delay<T.CampaignFull[]>(fx.campaignsFull)
export const getCampaignDetail = (id: string) => delay<T.CampaignDetail>(fx.campaignDetail(id))
export const getBriefDefaults = () => delay<T.Brief>(fx.briefDefaults)
export const getPromptTemplates = () => delay<T.PromptTemplate[]>(fx.promptTemplates)
export const getApprovals = () => delay<T.ApprovalItem[]>(fx.approvals)
export const getIntegrationsFull = () => delay<T.IntegrationDetail[]>(fx.integrationsFull)
```
(`delay`, `fx`, and the `T` namespace import already exist in this file.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd helm-app && npm test -- operate-data` then `npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: data layer for Operate surfaces (campaigns/studio/workspace/approvals/integrations)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared UI primitives (SlideOver, Tabs, Toast, FilterBar) + Toggle/StatusPill extensions

**Files:**
- Create: `helm-app/components/ui/SlideOver.tsx`, `Tabs.tsx`, `Toast.tsx`, `FilterBar.tsx`
- Modify: `helm-app/components/ui/Toggle.tsx`, `helm-app/components/ui/StatusPill.tsx`, `helm-app/app/globals.css` (append CSS)
- Test: `helm-app/test/operate-ui.test.tsx`

**Interfaces:**
- Produces: `SlideOver({ open, onClose, title, children })`; `Tabs({ tabs, active, onChange })` where `tabs: {id:string,label:string}[]`, `active: string`, `onChange:(id:string)=>void`; `ToastProvider` + `useToast(): { toast:(msg:string)=>void }`; `FilterBar({ children })`; `Select({ value, options, onChange })` (`options:{value:string,label:string}[]`); `SearchInput({ value, onChange, placeholder? })`; `Toggle({ on?, label?, onClick? })`; `StatusPill` accepting the new statuses.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/operate-ui.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlideOver } from '@/components/ui/SlideOver'
import { Tabs } from '@/components/ui/Tabs'
import { StatusPill } from '@/components/ui/StatusPill'

describe('operate ui', () => {
  it('SlideOver shows title when open and hides when closed', () => {
    const { rerender } = render(<SlideOver open title="Detail" onClose={() => {}}>body</SlideOver>)
    expect(screen.getByText('Detail')).toBeInTheDocument()
    rerender(<SlideOver open={false} title="Detail" onClose={() => {}}>body</SlideOver>)
    expect(screen.queryByText('Detail')).not.toBeInTheDocument()
  })
  it('Tabs calls onChange with the clicked tab id', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} active="a" onChange={onChange} />)
    await userEvent.click(screen.getByText('B'))
    expect(onChange).toHaveBeenCalledWith('b')
  })
  it('StatusPill accepts disconnected', () => {
    render(<StatusPill status="disconnected" />)
    expect(screen.getByText('disconnected')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- operate-ui`
Expected: FAIL (modules missing).

- [ ] **Step 3: Extend StatusPill**

Replace `helm-app/components/ui/StatusPill.tsx`:
```tsx
const MAP = {
  healthy: 'on', active: 'on', live: 'on',
  degraded: 'rev', invited: 'rev', review: 'rev',
  paused: 'off', disconnected: 'off', draft: 'off',
} as const

export function StatusPill({ status }: { status: keyof typeof MAP }) {
  return <span className={`status ${MAP[status]}`}><i />{status}</span>
}
```

- [ ] **Step 4: Extend Toggle**

Replace `helm-app/components/ui/Toggle.tsx`:
```tsx
export function Toggle({ on, label, onClick }: { on?: boolean; label?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={!!on}
      aria-label={label ?? 'Toggle'}
      onClick={onClick}
    />
  )
}
```

- [ ] **Step 5: Create SlideOver, Tabs, Toast, FilterBar**

`helm-app/components/ui/SlideOver.tsx`:
```tsx
'use client'
import type { ReactNode } from 'react'

export function SlideOver({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="so-backdrop" onClick={onClose}>
      <aside className="so-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="so-head">
          <h3>{title}</h3>
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="so-body">{children}</div>
      </aside>
    </div>
  )
}
```
`helm-app/components/ui/Tabs.tsx`:
```tsx
'use client'
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={`tab${t.id === active ? ' on' : ''}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  )
}
```
`helm-app/components/ui/Toast.tsx`:
```tsx
'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

const Ctx = createContext<{ toast: (msg: string) => void }>({ toast: () => {} })
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([])
  const toast = useCallback((msg: string) => {
    const id = items.length + Math.floor(performance.now())
    setItems((xs) => [...xs, { id, msg }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600)
  }, [items.length])
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack">
        {items.map((i) => <div key={i.id} className="toast">{i.msg}</div>)}
      </div>
    </Ctx.Provider>
  )
}
```
`helm-app/components/ui/FilterBar.tsx`:
```tsx
'use client'
import type { ReactNode } from 'react'

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filterbar">{children}</div>
}
export function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select className="fselect" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="fsearch" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search…'} />
}
```

- [ ] **Step 6: Append the CSS**

Append to `helm-app/app/globals.css`:
```css
/* SlideOver */
.so-backdrop{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);display:flex;justify-content:flex-end}
.so-panel{width:min(560px,92vw);height:100%;background:var(--panel);border-left:1px solid var(--line);overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.so-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.so-head h3{font-size:16px;font-weight:800}
.so-body{display:flex;flex-direction:column;gap:14px}
/* Tabs */
.tabs{display:flex;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:var(--pill);padding:3px;width:fit-content}
.tab{border:0;background:transparent;color:var(--dim);font-size:12px;font-weight:700;padding:6px 14px;border-radius:var(--pill);cursor:pointer;font-family:inherit}
.tab.on{background:color-mix(in srgb,var(--violet) 20%,transparent);color:var(--violet-2)}
/* Toast */
.toast-stack{position:fixed;right:20px;bottom:20px;z-index:80;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--card-2);border:1px solid var(--line-2);color:var(--text);font-size:12.5px;font-weight:600;padding:11px 15px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
/* FilterBar */
.filterbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.fselect,.fsearch{background:var(--card);border:1px solid var(--line);border-radius:var(--pill);padding:8px 13px;color:var(--text);font-size:12.5px;font-family:inherit}
.fsearch{min-width:220px}
.fselect:focus,.fsearch:focus{outline:none;border-color:color-mix(in srgb,var(--violet) 45%,transparent)}
```
Note: `--violet-2`, `--panel`, `--card-2`, `--line-2` already exist in `:root`.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd helm-app && npm test -- operate-ui` then full `npm test`, then `npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**
```bash
git add -A && git commit -m "feat: shared Operate primitives (SlideOver, Tabs, Toast, FilterBar) + Toggle/StatusPill extensions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: ApprovalsProvider + dynamic sidebar badge

**Files:**
- Create: `helm-app/lib/approvals.tsx`
- Modify: `helm-app/app/(app)/layout.tsx`, `helm-app/components/shell/Sidebar.tsx`
- Test: `helm-app/test/approvals-badge.test.tsx`

**Interfaces:**
- Consumes: `ToastProvider` (Task 2), `TenantProvider`, `AppShell`.
- Produces: `ApprovalsProvider` + `useApprovals(): { pending: number; setPending: (n: number) => void }` (default `pending: 3`). Sidebar renders the Approvals badge from `useApprovals().pending`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/approvals-badge.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { ApprovalsProvider, useApprovals } from '@/lib/approvals'
import { Sidebar } from '@/components/shell/Sidebar'

function Setter({ n }: { n: number }) {
  const { setPending } = useApprovals()
  return <button onClick={() => setPending(n)}>set</button>
}

describe('approvals badge', () => {
  it('sidebar shows the provider pending count', () => {
    render(<ApprovalsProvider><Sidebar role="master" /></ApprovalsProvider>)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- approvals-badge`
Expected: FAIL (`@/lib/approvals` missing / Sidebar not reading it).

- [ ] **Step 3: Create the provider**

`helm-app/lib/approvals.tsx`:
```tsx
'use client'
import { createContext, useContext, useState, ReactNode } from 'react'

const Ctx = createContext<{ pending: number; setPending: (n: number) => void }>({ pending: 3, setPending: () => {} })
export const useApprovals = () => useContext(Ctx)

export function ApprovalsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(3)
  return <Ctx.Provider value={{ pending, setPending }}>{children}</Ctx.Provider>
}
```

- [ ] **Step 4: Read the pending count in Sidebar**

In `helm-app/components/shell/Sidebar.tsx`: import `useApprovals` from `@/lib/approvals`, call `const { pending } = useApprovals()` inside the component, and where the badge is rendered for a nav item, use the dynamic count for the approvals item. Specifically, replace the badge expression so that for `it.page === 'approvals'` it renders `pending` (and hides when 0), otherwise renders `it.badge`. Example within the item map:
```tsx
const badge = it.page === 'approvals' ? pending : it.badge
// ...
{badge ? <span className="badge">{badge}</span> : null}
```

- [ ] **Step 5: Wire the providers into the layout**

In `helm-app/app/(app)/layout.tsx`, wrap the shell with the new providers (order: Tenant → Approvals → Toast → AppShell):
```tsx
import { TenantProvider } from '@/lib/tenant'
import { ApprovalsProvider } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/shell/AppShell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantProvider>
      <ApprovalsProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </ApprovalsProvider>
    </TenantProvider>
  )
}
```
(Match the existing import names; if `AppLayout` differs, keep the existing default export name and only add the provider wrapping.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd helm-app && npm test -- approvals-badge` then full `npm test`, then `npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: ApprovalsProvider + dynamic sidebar approvals badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Campaigns surface (list + filters + detail drawer)

**Files:**
- Create: `helm-app/app/(app)/campaigns/CampaignsView.tsx`
- Modify: `helm-app/app/(app)/campaigns/page.tsx` (replace placeholder), `helm-app/app/globals.css` (append CSS)
- Test: `helm-app/test/campaigns.test.tsx`

**Interfaces:**
- Consumes: `getCampaignsFull`, `getCampaignDetail` (Task 1); `FilterBar/Select/SearchInput`, `SlideOver` (Task 2); `Card`, `StatusPill`, `Button`, `TrendChart`; `inr`, `compact`.
- Produces: `CampaignsView({ campaigns }: { campaigns: CampaignFull[] })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/campaigns.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CampaignsView } from '@/app/(app)/campaigns/CampaignsView'
import { campaignsFull } from '@/lib/data/mock/fixtures'

describe('CampaignsView', () => {
  it('filters the list by search text', async () => {
    render(<CampaignsView campaigns={campaignsFull} />)
    expect(screen.getByText('FHC · Retargeting')).toBeInTheDocument()
    expect(screen.getByText('Search · Brand')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'Retargeting')
    expect(screen.getByText('FHC · Retargeting')).toBeInTheDocument()
    expect(screen.queryByText('Search · Brand')).not.toBeInTheDocument()
  })
  it('opens the detail drawer on row click', async () => {
    render(<CampaignsView campaigns={campaignsFull} />)
    await userEvent.click(screen.getByText('FHC · Retargeting'))
    expect(await screen.findByText(/Ad groups/i)).toBeInTheDocument()
    expect(screen.getByText(/Lowest CAC/i)).toBeInTheDocument()
  })
})
```
(The test imports fixtures directly — that's allowed in TESTS, not components.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- campaigns`
Expected: FAIL (`CampaignsView` missing).

- [ ] **Step 3: Build CampaignsView**

Create `helm-app/app/(app)/campaigns/CampaignsView.tsx`:
```tsx
'use client'
import { useState, useMemo } from 'react'
import type { CampaignFull, CampaignDetail } from '@/lib/types'
import { getCampaignDetail } from '@/lib/data'
import { Card } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import { SlideOver } from '@/components/ui/SlideOver'
import { FilterBar, Select, SearchInput } from '@/components/ui/FilterBar'
import { TrendChart } from '@/components/viz/TrendChart'
import { inr } from '@/lib/format'

export function CampaignsView({ campaigns }: { campaigns: CampaignFull[] }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [open, setOpen] = useState(false)

  const rows = useMemo(() => campaigns.filter((c) =>
    (status === 'all' || c.status === status) &&
    c.name.toLowerCase().includes(q.toLowerCase())
  ), [campaigns, q, status])

  async function openDetail(id: string) {
    setDetail(await getCampaignDetail(id))
    setOpen(true)
  }

  return (
    <div className="content">
      <div className="phead">
        <div><h1>Campaigns</h1><p>{campaigns.length} campaigns across Meta, Google, WhatsApp &amp; Email</p></div>
      </div>
      <Card>
        <FilterBar>
          <SearchInput value={q} onChange={setQ} placeholder="Search campaigns…" />
          <Select value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All status' }, { value: 'active', label: 'Active' },
            { value: 'review', label: 'In review' }, { value: 'paused', label: 'Paused' },
          ]} />
          <span className="pill" style={{ marginLeft: 'auto' }}>{rows.length} shown</span>
        </FilterBar>
        <table>
          <thead><tr>
            <th>Campaign</th><th>Channel</th><th>Status</th><th className="r">Spend</th><th>Pacing</th><th className="r">CAC</th><th className="r">ROAS</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(c.id)}>
                <td className="name">{c.name}</td>
                <td><span className="chan"><i style={{ background: `var(--${c.channelColor})` }} />{c.channel}</span></td>
                <td><StatusPill status={c.status} /></td>
                <td className="r">{inr(c.spend)}</td>
                <td>
                  <div className="pace">
                    <div className="minibar"><i style={{ width: `${Math.min(c.pacingPct, 100)}%`, background: c.pacingPct > 100 ? 'var(--bad)' : c.pacingPct > 90 ? 'var(--warn)' : 'var(--violet)' }} /></div>
                    <span className="num" style={{ fontSize: 11, color: 'var(--dim)' }}>{c.pacingPct}%</span>
                  </div>
                </td>
                <td className="r">{c.cac == null ? '—' : inr(c.cac)}</td>
                <td className="r">{c.roas ? c.roas.toFixed(1) + '×' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SlideOver open={open} onClose={() => setOpen(false)} title={detail?.campaign.name ?? 'Campaign'}>
        {detail && (
          <>
            <div className="so-meta">
              <div><span className="k">Objective</span><span className="v">{detail.campaign.objective}</span></div>
              <div><span className="k">Status</span><span className="v"><StatusPill status={detail.campaign.status} /></span></div>
              <div><span className="k">Budget</span><span className="v">{inr(detail.campaign.budget)}</span></div>
              <div><span className="k">Spend</span><span className="v">{inr(detail.campaign.spend)}</span></div>
              <div><span className="k">Started</span><span className="v">{detail.campaign.startedAt}</span></div>
              <div><span className="k">CAC</span><span className="v">{detail.campaign.cac == null ? '—' : inr(detail.campaign.cac)}</span></div>
            </div>
            <Card><div className="card-h"><div><h3>Daily results</h3><div className="sub">last 14 days</div></div></div><TrendChart /></Card>
            <Card>
              <div className="card-h"><div><h3>Ad groups</h3></div></div>
              <table><thead><tr><th>Name</th><th>Status</th><th className="r">Spend</th><th className="r">Results</th></tr></thead>
                <tbody>{detail.adGroups.map((g) => (
                  <tr key={g.id}><td className="name">{g.name}</td><td><StatusPill status={g.status} /></td><td className="r">{inr(g.spend)}</td><td className="r">{g.results}</td></tr>
                ))}</tbody></table>
            </Card>
            <Card>
              <div className="card-h"><div><h3>Creatives</h3></div></div>
              <div className="cre-grid">{detail.creatives.map((cr) => (
                <div key={cr.id} className="cre">
                  <div className="cre-thumb" style={{ background: `linear-gradient(135deg,var(--${cr.grad[0]}),var(--${cr.grad[1]}))` }}>{cr.kind}</div>
                  <div className="cre-meta"><div className="t">{cr.label}</div><StatusPill status={cr.status} /></div>
                </div>
              ))}</div>
            </Card>
          </>
        )}
      </SlideOver>
    </div>
  )
}
```

- [ ] **Step 4: Replace the page**

Replace `helm-app/app/(app)/campaigns/page.tsx`:
```tsx
import { getCampaignsFull } from '@/lib/data'
import { CampaignsView } from './CampaignsView'

export default async function CampaignsPage() {
  const campaigns = await getCampaignsFull()
  return <CampaignsView campaigns={campaigns} />
}
```

- [ ] **Step 5: Append the CSS**

Append to `helm-app/app/globals.css`:
```css
.pace{display:flex;align-items:center;gap:8px}
.pace .minibar{flex:1;max-width:90px}
.minibar{height:6px;border-radius:4px;background:var(--card-2);overflow:hidden;min-width:60px}
.minibar>i{display:block;height:100%;border-radius:4px}
.so-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.so-meta > div{display:flex;flex-direction:column;gap:2px}
.so-meta .k{font-size:10px;color:var(--faint);text-transform:uppercase;font-weight:600}
.so-meta .v{font-size:13px;font-weight:600}
.cre-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cre{display:flex;flex-direction:column;gap:8px}
.cre-thumb{height:80px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:11px;text-transform:uppercase}
.cre-meta .t{font-size:12px;font-weight:600;margin-bottom:4px}
```
(`.minibar` may already exist from an earlier task; if a `.minibar` rule is already present in globals.css, do NOT duplicate it — only add the rules that are missing.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd helm-app && npm test -- campaigns` then full `npm test`, then `npx tsc --noEmit`, then `npm run build`
Expected: PASS, clean, `/campaigns` compiles.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: Campaigns surface (filter/sort list + detail drawer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Creative Studio (brief → generate → variants → ship)

**Files:**
- Create: `helm-app/lib/studio.ts`, `helm-app/app/(app)/studio/StudioView.tsx`
- Modify: `helm-app/app/(app)/studio/page.tsx` (replace placeholder), `helm-app/app/globals.css` (append CSS)
- Test: `helm-app/test/studio.test.tsx`

**Interfaces:**
- Consumes: `getBriefDefaults` (Task 1); `Card`, `Button`, `Pill`; types `Brief`, `Variant`.
- Produces: `buildVariants(brief: Brief): Variant[]` (pure, in `lib/studio.ts`); `StudioView({ brief }: { brief: Brief })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/studio.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildVariants } from '@/lib/studio'
import { StudioView } from '@/app/(app)/studio/StudioView'
import { briefDefaults } from '@/lib/data/mock/fixtures'

describe('studio', () => {
  it('buildVariants returns 6 variants with at least one flagged', () => {
    const vs = buildVariants(briefDefaults)
    expect(vs.length).toBe(6)
    expect(vs.some((v) => v.compliance === 'flag')).toBe(true)
  })
  it('generate transitions to variants; ship moves a passing variant to Shipped', async () => {
    render(<StudioView brief={briefDefaults} />)
    await userEvent.click(screen.getByRole('button', { name: /generate/i }))
    const shipButtons = await screen.findAllByRole('button', { name: /^ship$/i })
    expect(shipButtons.length).toBeGreaterThan(0)
    await userEvent.click(shipButtons[0])
    expect(await screen.findByText(/Shipped/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- studio`
Expected: FAIL.

- [ ] **Step 3: Create the pure generator**

`helm-app/lib/studio.ts`:
```ts
import type { Brief, Variant, SeriesColor } from './types'

const GRADS: [SeriesColor, SeriesColor][] = [['violet', 'sky'], ['sky', 'emerald'], ['amber', 'rose'], ['violet', 'rose'], ['emerald', 'violet'], ['amber', 'violet']]

export function buildVariants(brief: Brief): Variant[] {
  const heads = [
    `${brief.hook}`,
    `Only ₹999 — ${brief.hook.toLowerCase()}`,
    `Your money, clearer in 20 minutes`,
    `${brief.offer} for ${brief.audience.split(',')[0]}`,
    `Guaranteed returns, zero guesswork`, // intentionally non-compliant
    `Start your Financial Health Checkup today`,
  ]
  return heads.map((headline, i) => {
    const flagged = /guarantee|assured|risk-free/i.test(headline)
    return {
      id: `v${i + 1}`,
      kind: brief.format === 'copy' ? 'copy' : 'image',
      headline,
      body: brief.format === 'copy' ? `${headline}. ${brief.offer}. Book now.` : undefined,
      grad: GRADS[i % GRADS.length],
      compliance: flagged ? 'flag' : 'pass',
      flagReason: flagged ? 'SEBI: implies guaranteed returns' : undefined,
    }
  })
}
```

- [ ] **Step 4: Build StudioView**

`helm-app/app/(app)/studio/StudioView.tsx`:
```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import type { Brief, Variant } from '@/lib/types'
import { buildVariants } from '@/lib/studio'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function StudioView({ brief }: { brief: Brief }) {
  const [form, setForm] = useState<Brief>(brief)
  const [phase, setPhase] = useState<'idle' | 'generating' | 'done'>('idle')
  const [variants, setVariants] = useState<Variant[]>([])
  const [shipped, setShipped] = useState<Variant[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function generate() {
    setPhase('generating'); setVariants([])
    timer.current = setTimeout(() => { setVariants(buildVariants(form)); setPhase('done') }, 1000)
  }
  function ship(v: Variant) {
    setShipped((s) => [...s, v]); setVariants((vs) => vs.filter((x) => x.id !== v.id))
  }

  return (
    <div className="content">
      <div className="phead"><div><h1>Creative Studio</h1><p>Brief → generate → SEBI gate → ship</p></div></div>
      <div className="studio">
        <Card className="studio-brief">
          <div className="card-h"><div><h3>Brief</h3></div></div>
          <label className="field"><span>Audience</span><input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} /></label>
          <label className="field"><span>Hook</span><input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} /></label>
          <label className="field"><span>Offer</span><input value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} /></label>
          <label className="field"><span>Format</span>
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as Brief['format'] })}>
              <option value="image">Image</option><option value="video">Video</option><option value="copy">Copy</option>
            </select>
          </label>
          <Button variant="primary" onClick={generate}>Generate</Button>
        </Card>
        <div className="studio-out">
          {phase === 'generating' && <div className="var-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="var skeleton" />)}</div>}
          {phase === 'done' && (
            <>
              <div className="var-grid">
                {variants.map((v) => (
                  <div key={v.id} className="var">
                    {v.kind === 'image'
                      ? <div className="var-thumb" style={{ background: `linear-gradient(135deg,var(--${v.grad[0]}),var(--${v.grad[1]}))` }}>{v.headline}</div>
                      : <div className="var-copy">{v.body}</div>}
                    <div className="var-foot">
                      <span className={`gate ${v.compliance}`}>{v.compliance === 'pass' ? 'SEBI pass' : `SEBI flag`}</span>
                      <Button onClick={() => ship(v)} {...(v.compliance === 'flag' ? { disabled: true } : {})}>Ship</Button>
                    </div>
                    {v.flagReason && <div className="var-flag">{v.flagReason}</div>}
                  </div>
                ))}
              </div>
              {shipped.length > 0 && (
                <Card>
                  <div className="card-h"><div><h3>Shipped ({shipped.length})</h3></div></div>
                  <div className="ship-strip">{shipped.map((v) => <div key={v.id} className="ship-chip">{v.headline}<span className="num">₹{300 + Math.floor(Math.random() * 200)} CAC</span></div>)}</div>
                </Card>
              )}
            </>
          )}
          {phase === 'idle' && <Card><div className="empty"><h3>No variants yet</h3><p>Fill the brief and hit Generate to see mock creative variants with a SEBI compliance gate.</p></div></Card>}
        </div>
      </div>
    </div>
  )
}
```
Note: `Math.random()` is fine in a browser client component (this is not a workflow script); it runs at ship time, not during SSR.

- [ ] **Step 5: Replace the page**

Replace `helm-app/app/(app)/studio/page.tsx`:
```tsx
import { getBriefDefaults } from '@/lib/data'
import { StudioView } from './StudioView'

export default async function StudioPage() {
  const brief = await getBriefDefaults()
  return <StudioView brief={brief} />
}
```

- [ ] **Step 6: Append the CSS**

Append to `helm-app/app/globals.css`:
```css
.studio{display:grid;grid-template-columns:320px 1fr;gap:14px}
.studio-brief{align-self:start}
.field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--dim);font-weight:600}
.field input,.field select{background:var(--card-2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit}
.var-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.var{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:9px}
.var-thumb{height:120px;border-radius:12px;display:grid;place-items:center;text-align:center;padding:12px;color:#fff;font-weight:700;font-size:14px}
.var-copy{background:var(--card-2);border-radius:12px;padding:14px;font-size:13px;min-height:120px}
.var-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}
.gate{font-size:10px;font-weight:700;padding:3px 9px;border-radius:var(--pill)}
.gate.pass{background:color-mix(in srgb,var(--emerald) 15%,transparent);color:var(--good)}
.gate.flag{background:color-mix(in srgb,var(--rose) 15%,transparent);color:var(--bad)}
.var-flag{font-size:10.5px;color:var(--bad)}
.skeleton{height:170px;background:linear-gradient(90deg,var(--card),var(--card-2),var(--card));background-size:200% 100%;animation:sk 1.2s infinite}
@keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ship-strip{display:flex;flex-wrap:wrap;gap:8px}
.ship-chip{display:flex;flex-direction:column;gap:2px;background:var(--card-2);border:1px solid var(--line);border-radius:12px;padding:9px 12px;font-size:12px;font-weight:600}
.ship-chip .num{font-size:10px;color:var(--faint)}
@media(max-width:820px){.studio{grid-template-columns:1fr}}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd helm-app && npm test -- studio` then full `npm test`, then `npx tsc --noEmit`, then `npm run build`
Expected: PASS, clean, `/studio` compiles.

- [ ] **Step 8: Commit**
```bash
git add -A && git commit -m "feat: Creative Studio (brief -> generate -> SEBI gate -> ship)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: LLM Workspace (chat + prompt library + citations)

**Files:**
- Create: `helm-app/lib/workspace.ts`, `helm-app/app/(app)/workspace/WorkspaceView.tsx`
- Modify: `helm-app/app/(app)/workspace/page.tsx` (replace placeholder), `helm-app/app/globals.css` (append CSS)
- Test: `helm-app/test/workspace.test.tsx`

**Interfaces:**
- Consumes: `getPromptTemplates` (Task 1); `Card`, `Button`; types `PromptTemplate`, `ChatMessage`, `Citation`.
- Produces: `cannedReply(prompt: string): { text: string; citations: Citation[] }` (pure, in `lib/workspace.ts`); `WorkspaceView({ templates }: { templates: PromptTemplate[] })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/workspace.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cannedReply } from '@/lib/workspace'
import { WorkspaceView } from '@/app/(app)/workspace/WorkspaceView'
import { promptTemplates } from '@/lib/data/mock/fixtures'

describe('workspace', () => {
  it('cannedReply returns text + citations', () => {
    const r = cannedReply('summarise CAC')
    expect(r.text.length).toBeGreaterThan(0)
    expect(r.citations.length).toBeGreaterThan(0)
  })
  it('clicking a prompt template inserts its text into the input', async () => {
    render(<WorkspaceView templates={promptTemplates} />)
    await userEvent.click(screen.getByText('Ad brief'))
    const input = screen.getByPlaceholderText(/ask anything/i) as HTMLTextAreaElement
    expect(input.value).toMatch(/ad brief/i)
  })
  it('sending a message appends the user text and an assistant reply', async () => {
    render(<WorkspaceView templates={promptTemplates} />)
    const input = screen.getByPlaceholderText(/ask anything/i)
    await userEvent.type(input, 'How is CAC trending?')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByText('How is CAC trending?')).toBeInTheDocument()
    expect(await screen.findByText(/HELM/i, {}, { timeout: 3000 })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- workspace`
Expected: FAIL.

- [ ] **Step 3: Create the canned responder**

`helm-app/lib/workspace.ts`:
```ts
import type { Citation } from './types'

export function cannedReply(prompt: string): { text: string; citations: Citation[] } {
  const text = `Here's a grounded read based on Finnovate's last 30 days. ${prompt.trim().replace(/\s+/g, ' ').slice(0, 80)} — blended CAC is ₹412 (down 12%), checkups are up 8.3%, and Meta Retargeting is your most efficient source at ₹341 CAC. I'd shift spend toward it and pause Search · Competitor (₹550 CAC).`
  const citations: Citation[] = [
    { label: 'CAC · 30d', source: 'Analytics · Finnovate' },
    { label: 'FHC · Retargeting', source: 'Campaigns' },
    { label: 'Search · Competitor', source: 'Campaigns' },
  ]
  return { text, citations }
}
```

- [ ] **Step 4: Build WorkspaceView**

`helm-app/app/(app)/workspace/WorkspaceView.tsx`:
```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import type { PromptTemplate, ChatMessage } from '@/lib/types'
import { cannedReply } from '@/lib/workspace'
import { Card } from '@/components/ui/Card'

const MODELS = ['Claude', 'GPT', 'Gemini']

export function WorkspaceView({ templates }: { templates: PromptTemplate[] }) {
  const [model, setModel] = useState('Claude')
  const [grounded, setGrounded] = useState(true)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function send() {
    const text = input.trim(); if (!text) return
    const userMsg: ChatMessage = { id: `u${messages.length}`, role: 'user', text }
    setMessages((m) => [...m, userMsg]); setInput('')
    const { text: reply, citations } = cannedReply(text)
    timer.current = setTimeout(() => {
      setMessages((m) => [...m, { id: `a${m.length}`, role: 'assistant', text: `HELM · ${model}: ${reply}`, citations: grounded ? citations : undefined }])
    }, 500)
  }

  return (
    <div className="content">
      <div className="phead"><div><h1>Workspace</h1><p>Grounded chat routed via the Model Gateway</p></div></div>
      <div className="ws">
        <Card className="ws-lib">
          <div className="card-h"><div><h3>Prompt library</h3></div></div>
          {templates.map((t) => <button key={t.id} type="button" className="ws-tpl" onClick={() => setInput(t.body)}>{t.title}</button>)}
        </Card>
        <Card className="ws-chat">
          <div className="ws-top">
            <div className="ws-models">{MODELS.map((m) => <button key={m} type="button" className={`ws-model${m === model ? ' on' : ''}`} onClick={() => setModel(m)}>{m}<span>via Gateway</span></button>)}</div>
            <button type="button" className={`ws-ground${grounded ? ' on' : ''}`} onClick={() => setGrounded((g) => !g)}>Grounded {grounded ? 'on' : 'off'}</button>
          </div>
          <div className="ws-thread">
            {messages.length === 0 && <div className="ws-hero"><div className="ws-orb" /><h2>Let's start a smart conversation</h2><p>Ask about campaigns, CAC, audiences — grounded on Finnovate's data.</p></div>}
            {messages.map((m) => (
              <div key={m.id} className={`ws-msg ${m.role}`}>
                <div className="ws-bubble">{m.text}</div>
                {m.citations && <div className="ws-cites">{m.citations.map((c, i) => <span key={i} className="ws-cite">{c.label}<em>{c.source}</em></span>)}</div>}
              </div>
            ))}
          </div>
          <div className="ws-input">
            <textarea placeholder="Ask anything…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button type="button" className="btn primary" aria-label="Send" onClick={send}>Send</button>
          </div>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Replace the page**

Replace `helm-app/app/(app)/workspace/page.tsx`:
```tsx
import { getPromptTemplates } from '@/lib/data'
import { WorkspaceView } from './WorkspaceView'

export default async function WorkspacePage() {
  const templates = await getPromptTemplates()
  return <WorkspaceView templates={templates} />
}
```

- [ ] **Step 6: Append the CSS**

Append to `helm-app/app/globals.css`:
```css
.ws{display:grid;grid-template-columns:220px 1fr;gap:14px;min-height:70vh}
.ws-lib{align-self:start}
.ws-tpl{display:block;width:100%;text-align:left;background:var(--card-2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;margin-bottom:6px;font-family:inherit}
.ws-tpl:hover{border-color:color-mix(in srgb,var(--violet) 40%,transparent)}
.ws-chat{min-height:70vh}
.ws-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ws-models{display:flex;gap:6px}
.ws-model{display:flex;flex-direction:column;align-items:flex-start;background:var(--card-2);border:1px solid var(--line);border-radius:12px;padding:6px 12px;color:var(--dim);font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}
.ws-model span{font-size:8.5px;color:var(--faint);font-weight:500}
.ws-model.on{border-color:transparent;background:color-mix(in srgb,var(--violet) 20%,transparent);color:var(--violet-2)}
.ws-ground{background:var(--card-2);border:1px solid var(--line);border-radius:var(--pill);padding:7px 13px;color:var(--dim);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
.ws-ground.on{color:var(--emerald);border-color:color-mix(in srgb,var(--emerald) 30%,transparent)}
.ws-thread{flex:1;display:flex;flex-direction:column;gap:14px;padding:8px 0;overflow-y:auto}
.ws-hero{margin:auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--dim)}
.ws-hero h2{font-size:22px;font-weight:800;color:var(--text)}
.ws-orb{width:74px;height:74px;border-radius:50%;background:conic-gradient(from 0deg,var(--violet),var(--sky),var(--emerald),var(--violet));filter:blur(1px)}
.ws-msg{display:flex;flex-direction:column;gap:6px;max-width:80%}
.ws-msg.user{align-self:flex-end;align-items:flex-end}
.ws-bubble{padding:11px 14px;border-radius:14px;font-size:13px;line-height:1.5}
.ws-msg.user .ws-bubble{background:linear-gradient(135deg,var(--violet),var(--indigo));color:#fff}
.ws-msg.assistant .ws-bubble{background:var(--card-2);border:1px solid var(--line)}
.ws-cites{display:flex;gap:6px;flex-wrap:wrap}
.ws-cite{display:flex;flex-direction:column;background:color-mix(in srgb,var(--violet) 10%,transparent);border:1px solid color-mix(in srgb,var(--violet) 22%,transparent);border-radius:8px;padding:3px 8px;font-size:10px;font-weight:700;color:var(--violet-2)}
.ws-cite em{font-style:normal;font-size:8.5px;color:var(--faint);font-weight:500}
.ws-input{display:flex;gap:8px;align-items:flex-end;border-top:1px solid var(--line);padding-top:12px}
.ws-input textarea{flex:1;resize:none;min-height:44px;max-height:120px;background:var(--card-2);border:1px solid var(--line);border-radius:12px;padding:11px 13px;color:var(--text);font-size:13px;font-family:inherit}
@media(max-width:820px){.ws{grid-template-columns:1fr}}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd helm-app && npm test -- workspace` then full `npm test`, then `npx tsc --noEmit`, then `npm run build`
Expected: PASS, clean, `/workspace` compiles.

- [ ] **Step 8: Commit**
```bash
git add -A && git commit -m "feat: LLM Workspace (chat, prompt library, grounded citations)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Approvals Inbox (pending/decided tabs + decisions + badge sync)

**Files:**
- Create: `helm-app/app/(app)/approvals/ApprovalsView.tsx`
- Modify: `helm-app/app/(app)/approvals/page.tsx` (replace placeholder), `helm-app/app/globals.css` (append CSS)
- Test: `helm-app/test/approvals-view.test.tsx`

**Interfaces:**
- Consumes: `getApprovals` (Task 1); `useApprovals` (Task 3); `useToast` (Task 2); `Tabs` (Task 2); `Card`, `Button`; type `ApprovalItem`.
- Produces: `ApprovalsView({ items }: { items: ApprovalItem[] })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/approvals-view.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApprovalsView } from '@/app/(app)/approvals/ApprovalsView'
import { ApprovalsProvider, useApprovals } from '@/lib/approvals'
import { ToastProvider } from '@/components/ui/Toast'
import { approvals } from '@/lib/data/mock/fixtures'

function Count() { const { pending } = useApprovals(); return <div data-testid="count">{pending}</div> }

function wrap(ui: React.ReactNode) {
  return <ApprovalsProvider><ToastProvider>{ui}<Count /></ToastProvider></ApprovalsProvider>
}

describe('ApprovalsView', () => {
  it('approving removes the item and decrements the pending count', async () => {
    render(wrap(<ApprovalsView items={approvals} />))
    expect(screen.getByTestId('count').textContent).toBe('3')
    expect(screen.getByText('+₹15K to Lookalike 2%')).toBeInTheDocument()
    const firstCard = screen.getByText('+₹15K to Lookalike 2%').closest('.appr-card') as HTMLElement
    await userEvent.click(within(firstCard).getByRole('button', { name: /approve/i }))
    expect(screen.queryByText('+₹15K to Lookalike 2%')).not.toBeInTheDocument()
    expect(screen.getByTestId('count').textContent).toBe('2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- approvals-view`
Expected: FAIL.

- [ ] **Step 3: Build ApprovalsView**

`helm-app/app/(app)/approvals/ApprovalsView.tsx`:
```tsx
'use client'
import { useState, useEffect } from 'react'
import type { ApprovalItem } from '@/lib/types'
import { useApprovals } from '@/lib/approvals'
import { useToast } from '@/components/ui/Toast'
import { Tabs } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type Decided = { item: ApprovalItem; outcome: 'approved' | 'rejected' }

export function ApprovalsView({ items }: { items: ApprovalItem[] }) {
  const { setPending } = useApprovals()
  const { toast } = useToast()
  const [tab, setTab] = useState('pending')
  const [pending, setList] = useState<ApprovalItem[]>(items)
  const [decided, setDecided] = useState<Decided[]>([])

  useEffect(() => { setPending(pending.length) }, [pending.length, setPending])

  function decide(item: ApprovalItem, outcome: 'approved' | 'rejected') {
    setList((xs) => xs.filter((x) => x.id !== item.id))
    setDecided((d) => [{ item, outcome }, ...d])
    toast(`${item.action} ${outcome}`)
  }

  return (
    <div className="content">
      <div className="phead"><div><h1>Approvals Inbox</h1><p>Agents propose · you dispose · resumes from checkpoint</p></div></div>
      <Tabs tabs={[{ id: 'pending', label: `Pending (${pending.length})` }, { id: 'decided', label: `Decided (${decided.length})` }]} active={tab} onChange={setTab} />
      {tab === 'pending' && (
        <div className="appr-list">
          {pending.length === 0 && <Card><div className="empty"><h3>All clear</h3><p>No proposals waiting on you.</p></div></Card>}
          {pending.map((it) => (
            <Card key={it.id} className="appr-card">
              <div className="appr-head">
                <div className="appr-agent">{it.agentCode}</div>
                <div><div className="appr-title">{it.summary}</div><div className="appr-sub">{it.agent} · {it.action} · {it.proposedAt}</div></div>
              </div>
              <p className="appr-payload">{it.payload}</p>
              <div className="appr-checks">{it.checks.map((c, i) => <span key={i} className={`chk-pill ${c.status}`}>{c.label}</span>)}</div>
              <div className="appr-actions">
                <Button variant="primary" onClick={() => decide(it, 'approved')}>Approve</Button>
                <Button onClick={() => decide(it, 'approved')}>Edit</Button>
                <Button onClick={() => decide(it, 'rejected')}>Reject</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === 'decided' && (
        <div className="appr-list">
          {decided.length === 0 && <Card><div className="empty"><h3>Nothing decided yet</h3><p>Approved and rejected proposals appear here.</p></div></Card>}
          {decided.map(({ item, outcome }, i) => (
            <Card key={i} className="appr-card">
              <div className="appr-head"><div className="appr-agent">{item.agentCode}</div>
                <div><div className="appr-title">{item.summary}</div><div className="appr-sub">{item.agent} · {item.action}</div></div>
                <span className={`chk-pill ${outcome === 'approved' ? 'pass' : 'warn'}`} style={{ marginLeft: 'auto' }}>{outcome}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Replace the page**

Replace `helm-app/app/(app)/approvals/page.tsx`:
```tsx
import { getApprovals } from '@/lib/data'
import { ApprovalsView } from './ApprovalsView'

export default async function ApprovalsPage() {
  const items = await getApprovals()
  return <ApprovalsView items={items} />
}
```

- [ ] **Step 5: Append the CSS**

Append to `helm-app/app/globals.css`:
```css
.appr-list{display:flex;flex-direction:column;gap:12px}
.appr-card{gap:11px}
.appr-head{display:flex;align-items:center;gap:11px}
.appr-agent{width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center;font-weight:800;font-size:11px;color:#fff;background:linear-gradient(135deg,var(--violet),var(--indigo))}
.appr-title{font-size:13.5px;font-weight:700}
.appr-sub{font-size:11px;color:var(--faint)}
.appr-payload{font-size:12.5px;color:var(--dim);line-height:1.5}
.appr-checks{display:flex;gap:8px;flex-wrap:wrap}
.chk-pill{font-size:10px;font-weight:700;padding:3px 9px;border-radius:var(--pill)}
.chk-pill.pass{background:color-mix(in srgb,var(--emerald) 14%,transparent);color:var(--good)}
.chk-pill.warn{background:color-mix(in srgb,var(--amber) 14%,transparent);color:var(--warn)}
.appr-actions{display:flex;gap:8px}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd helm-app && npm test -- approvals-view` then full `npm test`, then `npx tsc --noEmit`, then `npm run build`
Expected: PASS, clean, `/approvals` compiles.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: Approvals Inbox (pending/decided tabs, decisions, badge sync)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Integrations (connector grid + connect toggle)

**Files:**
- Create: `helm-app/app/(app)/integrations/IntegrationsView.tsx`
- Modify: `helm-app/app/(app)/integrations/page.tsx` (replace placeholder), `helm-app/app/globals.css` (append CSS)
- Test: `helm-app/test/integrations.test.tsx`

**Interfaces:**
- Consumes: `getIntegrationsFull` (Task 1); `useToast` (Task 2); `Card`, `StatusPill`, `Button`; type `IntegrationDetail`.
- Produces: `IntegrationsView({ integrations }: { integrations: IntegrationDetail[] })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/integrations.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/Toast'
import { IntegrationsView } from '@/app/(app)/integrations/IntegrationsView'
import { integrationsFull } from '@/lib/data/mock/fixtures'

describe('IntegrationsView', () => {
  it('connecting a disconnected connector flips it to healthy', async () => {
    render(<ToastProvider><IntegrationsView integrations={integrationsFull} /></ToastProvider>)
    const card = screen.getByText('Segment').closest('.int-card') as HTMLElement
    expect(within(card).getByText('disconnected')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /connect/i }))
    expect(within(card).getByText('healthy')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd helm-app && npm test -- integrations`
Expected: FAIL.

- [ ] **Step 3: Build IntegrationsView**

`helm-app/app/(app)/integrations/IntegrationsView.tsx`:
```tsx
'use client'
import { useState } from 'react'
import type { IntegrationDetail } from '@/lib/types'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'

export function IntegrationsView({ integrations }: { integrations: IntegrationDetail[] }) {
  const { toast } = useToast()
  const [list, setList] = useState<IntegrationDetail[]>(integrations)

  function toggleConn(id: string) {
    setList((xs) => xs.map((i) => {
      if (i.id !== id) return i
      const next = i.status === 'disconnected' ? 'healthy' : 'disconnected'
      toast(`${i.name} ${next === 'healthy' ? 'connected' : 'disconnected'}`)
      return { ...i, status: next }
    }))
  }

  return (
    <div className="content">
      <div className="phead"><div><h1>Integrations</h1><p>Marketing platforms via MCP · per-tenant credentials</p></div></div>
      <div className="int-grid">
        {list.map((i) => (
          <Card key={i.id} className="int-card">
            <div className="int-head">
              <div className="int-logo" style={{ background: `linear-gradient(135deg,var(--${i.grad[0]}),var(--${i.grad[1]}))` }}>{i.name.slice(0, 2)}</div>
              <div><div className="int-name">{i.name}</div><div className="int-auth">{i.auth}</div></div>
              <StatusPill status={i.status} />
            </div>
            <div className="int-meta">
              <div><span className="k">Last sync</span><span className="v">{i.lastSync}</span></div>
              <div><span className="k">Calls 24h</span><span className="v">{i.calls}</span></div>
            </div>
            <div className="int-scopes">{i.scopes.length ? i.scopes.map((s) => <span key={s} className="scope">{s}</span>) : <span className="scope muted">no scopes</span>}</div>
            <Button onClick={() => toggleConn(i.id)} variant={i.status === 'disconnected' ? 'primary' : 'ghost'}>
              {i.status === 'disconnected' ? 'Connect' : 'Disconnect'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace the page**

Replace `helm-app/app/(app)/integrations/page.tsx`:
```tsx
import { getIntegrationsFull } from '@/lib/data'
import { IntegrationsView } from './IntegrationsView'

export default async function IntegrationsPage() {
  const integrations = await getIntegrationsFull()
  return <IntegrationsView integrations={integrations} />
}
```

- [ ] **Step 5: Append the CSS**

Append to `helm-app/app/globals.css`:
```css
.int-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.int-card{gap:12px}
.int-head{display:flex;align-items:center;gap:11px}
.int-logo{width:38px;height:38px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;font-weight:800;font-size:13px}
.int-name{font-size:13.5px;font-weight:700}
.int-auth{font-size:10.5px;color:var(--faint)}
.int-head .status{margin-left:auto}
.int-meta{display:flex;gap:20px}
.int-meta > div{display:flex;flex-direction:column;gap:2px}
.int-meta .k{font-size:9.5px;color:var(--faint);text-transform:uppercase;font-weight:600}
.int-meta .v{font-size:12.5px;font-weight:700}
.int-scopes{display:flex;gap:6px;flex-wrap:wrap;min-height:22px}
.scope{font-size:10px;font-weight:600;padding:2px 8px;border-radius:var(--pill);background:var(--card-2);border:1px solid var(--line);color:var(--dim)}
.scope.muted{color:var(--faint)}
@media(max-width:1240px){.int-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){.int-grid{grid-template-columns:1fr}}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd helm-app && npm test -- integrations` then full `npm test`, then `npx tsc --noEmit`, then `npm run build`
Expected: PASS, clean, `/integrations` compiles.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: Integrations surface (connector grid + connect toggle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Whole-surface verification pass

**Files:**
- Test: `helm-app/test/operate-smoke.test.tsx`

- [ ] **Step 1: Write a smoke test that no placeholder remains**

Create `helm-app/test/operate-smoke.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { campaignsFull, approvals, integrationsFull, promptTemplates } from '@/lib/data/mock/fixtures'

describe('operate surfaces data present', () => {
  it('has data behind every surface', () => {
    expect(campaignsFull.length).toBeGreaterThanOrEqual(6)
    expect(approvals.length).toBe(3)
    expect(integrationsFull.length).toBeGreaterThanOrEqual(7)
    expect(promptTemplates.length).toBeGreaterThanOrEqual(4)
  })
})
```

- [ ] **Step 2: Run the full suite**

Run: `cd helm-app && npm test`
Expected: ALL pass (report the count).

- [ ] **Step 3: Type + build gates**

Run: `npx tsc --noEmit` (clean), then `npm run build` (succeeds; confirm `/campaigns`, `/studio`, `/workspace`, `/approvals`, `/integrations` all compile).

- [ ] **Step 4: Manual interaction note**

In your report, note that a manual pass at 375/768/1024/1440 is recommended (the surfaces use `@media(max-width:820px)`/`1240px` rules; verify no horizontal scroll). Confirm the five pages no longer show `EmptyState` placeholders.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "test: operate surfaces smoke + verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 server-fetch→client-interact + data extension → Task 1 (data), Tasks 4–8 (each page server-fetches, View is client). ✓
- §4.1 Campaigns (list/filter/drawer/detail) → Task 4. ✓
- §4.2 Creative Studio (brief→generate→SEBI gate→ship) → Task 5. ✓
- §4.3 Workspace (model pills, streamed-ish reply, citations, prompt library, grounded toggle) → Task 6. ✓
- §4.4 Approvals (pending/decided, approve/edit/reject, toast, badge decrement) → Tasks 3 + 7. ✓
- §4.5 Integrations (connector grid, status, connect toggle) → Task 8. ✓
- §5 new components (SlideOver, Tabs, Toast, FilterBar, ApprovalsProvider) → Tasks 2, 3. ✓
- §6 per-surface behavior tests → each task's test. ✓
- §7 success criteria (no placeholders, data via lib/data, dark+light, a11y, build) → Tasks 4–9. ✓

**Placeholder scan:** No "TBD"/"handle errors". Every code step contains real code. Simulated timers are concrete. CSS blocks are complete with real values.

**Type consistency:** Service fns (`getCampaignsFull`, `getCampaignDetail`, `getBriefDefaults`, `getPromptTemplates`, `getApprovals`, `getIntegrationsFull`) defined in Task 1 are consumed verbatim in Tasks 4–8. Types (`CampaignFull`, `CampaignDetail`, `Brief`, `Variant`, `PromptTemplate`, `ChatMessage`, `Citation`, `ApprovalItem`, `IntegrationDetail`) defined in Task 1, used consistently. `useApprovals(): {pending,setPending}` defined Task 3, consumed Task 7. `useToast(): {toast}` defined Task 2, consumed Tasks 7, 8. `Tabs({tabs,active,onChange})`, `SlideOver({open,onClose,title,children})`, `FilterBar`/`Select`/`SearchInput`, `Toggle({on,label,onClick})`, `StatusPill` extended — all consistent. `buildVariants`/`cannedReply` pure helpers defined and tested in their own tasks.

**Known consideration:** `StatusPill` gains `disconnected/live/draft/review` (Task 2) — the Task 11 Training page (prior sub-project) used a local status map for `running/deployed/queued/shadow`; those are NOT added here (not needed), so no conflict. `.minibar` may already exist in globals.css from sub-project 1 — Task 4 Step 5 explicitly says not to duplicate it.

No gaps found.

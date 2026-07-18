# HELM Frontend Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete HELM UI shell — Analytics console + Master Console (agent fleet, model gateway, training, RBAC, system config) + wired Operate placeholders — as a Next.js app running on realistic mock data behind a swappable typed data layer.

**Architecture:** Next.js App Router + TypeScript + Tailwind + shadcn/ui. Every screen reads through a typed `lib/data` service (mock fixtures now, real BFF later). Theming via CSS custom properties (dark-first + light). Navigation is sidebar-routed and RBAC-gated. The approved visual system lives in `helm-mockup-v4.html` at repo root — port its markup/CSS into React components; it is the pixel source of truth.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Vitest + React Testing Library + jsdom, Open Sans (via `next/font/google` or Google Fonts link), lucide-react for icons.

## Global Constraints

- **Font:** Open Sans everywhere; numbers use tabular-lining figures (`font-variant-numeric: tabular-nums`). No display/monospace fonts.
- **Theme:** dark is the default (`<html data-theme="dark">`); light theme provided. All colors are CSS variables; never hardcode hex in components.
- **Accent discipline:** violet `#8b5cf6` is the only primary accent; emerald `#34d399` = live/good; rose = bad/over; amber = caution. Semantic colors are consistent (lower-is-better metrics like CAC still render green when improving).
- **Shape:** cards `border-radius: 16px`; **all buttons, inputs, pills, segmented controls, and icon buttons are full pills** (`border-radius: 999px`).
- **Icons:** lucide-react only, ~1.75 stroke width.
- **Data discipline:** components NEVER import fixtures directly — only via `lib/data`. No component holds hardcoded metric values.
- **Currency/number format:** Indian grouping and K/L/Cr; ₹ prefix; percentages with `pp` for point deltas. All via `lib/format.ts`.
- **Mock realism:** funnel totals must reconcile with channel + campaign sums; CAC/ROAS/LTV math must be internally consistent.
- **Commits:** conventional commits, frequent (one per task minimum). End commit messages with the Co-Authored-By trailer used in this repo.

---

## File Structure

```
helm-app/                          # Next.js app (created in Task 1)
  app/
    layout.tsx                     # root: fonts, <html data-theme>, ThemeProvider
    globals.css                    # CSS variables (dark+light), base, Tailwind
    (app)/
      layout.tsx                   # AppShell (sidebar + topbar) wraps all routes
      analytics/page.tsx
      campaigns/page.tsx
      studio/page.tsx
      workspace/page.tsx
      integrations/page.tsx
      approvals/page.tsx
      agents/page.tsx              # Master Console
      gateway/page.tsx
      training/page.tsx
      rbac/page.tsx
      system/page.tsx
    page.tsx                       # redirect '/' -> '/analytics'
  lib/
    types.ts                       # canonical entities (mirror HELM_ARCHITECTURE §11)
    format.ts                      # ₹ / % / K-L-Cr / delta helpers
    rbac.ts                        # Role -> capabilities; nav gating
    tenant.tsx                     # TenantProvider + useTenant
    theme.tsx                      # ThemeProvider + useTheme (data-theme toggle)
    nav.ts                         # nav item definitions (label, href, icon, capability)
    data/
      index.ts                     # service interface (async funcs) — the swap seam
      mock/fixtures.ts             # realistic, reconciled mock data
  components/
    shell/{Sidebar,TopBar,AppShell}.tsx
    ui/{Button,Pill,StatusPill,Toggle,DeltaBadge,Card,EmptyState,SegControl}.tsx
    viz/{StatTile,Sparkline,TrendChart,FunnelChart,SplitBar,RadialGauge,Heatmap,DataTable,LiveActivityRail,AIInsightChip,PermissionMatrix,AgentCard}.tsx
  test/setup.ts                    # RTL + jsdom setup
  vitest.config.ts
```

---

### Task 1: Project scaffold + test harness

**Files:**
- Create: `helm-app/` (Next.js app), `helm-app/vitest.config.ts`, `helm-app/test/setup.ts`, `helm-app/test/smoke.test.ts`
- Modify: `helm-app/package.json` (scripts, deps)

**Interfaces:**
- Produces: a running Next.js app; `npm test` runs Vitest; `npm run dev` serves the app.

- [ ] **Step 1: Scaffold Next.js app**

Run from repo root (`C:/Users/anike/Desktop/HELM`):
```bash
npx create-next-app@latest helm-app --ts --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-turbopack --use-npm
```
Answer any prompt with defaults. Expected: `helm-app/` created with `app/`, `package.json`.

- [ ] **Step 2: Add test + icon deps**

```bash
cd helm-app && npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event && npm i lucide-react
```

- [ ] **Step 3: Configure Vitest**

Create `helm-app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

Create `helm-app/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

Add to `helm-app/package.json` `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write the smoke test**

Create `helm-app/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('harness', () => {
  it('runs', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 6: Verify dev server boots**

Run: `npm run dev` then open `http://localhost:3000`. Expected: default Next page renders. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add helm-app && git commit -m "chore: scaffold Next.js app with Vitest harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Design tokens + theme system

**Files:**
- Create: `helm-app/lib/theme.tsx`, `helm-app/test/theme.test.tsx`
- Modify: `helm-app/app/globals.css`, `helm-app/app/layout.tsx`

**Interfaces:**
- Produces: `ThemeProvider` (React component), `useTheme(): { theme: 'dark'|'light', toggle: () => void }`. CSS variables available globally.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/theme.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from '@/lib/theme'

function Probe() {
  const { theme, toggle } = useTheme()
  return <button onClick={toggle}>theme:{theme}</button>
}

describe('theme', () => {
  it('defaults to dark and toggles', async () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button').textContent).toBe('theme:dark')
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('theme:light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL** (`Cannot find module '@/lib/theme'`)

Run: `npm test -- theme`

- [ ] **Step 3: Implement theme**

Create `helm-app/lib/theme.tsx`:
```tsx
'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'dark' | 'light'
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  return <Ctx.Provider value={{ theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) }}>{children}</Ctx.Provider>
}
export const useTheme = () => useContext(Ctx)
```

- [ ] **Step 4: Port design tokens into globals.css**

Replace `helm-app/app/globals.css` with Tailwind import + the full `:root` and `html[data-theme="light"]` variable blocks and base styles from `helm-mockup-v4.html` (`<style>` head — the `:root{…}`, `html[data-theme="light"]{…}`, `*{…}`, `body{…}` rules). Keep `@import "tailwindcss";` at the top. This is the single source of color/shape tokens.

- [ ] **Step 5: Wire root layout**

Set `helm-app/app/layout.tsx` to load Open Sans and wrap children:
```tsx
import './globals.css'
import { Open_Sans } from 'next/font/google'
import { ThemeProvider } from '@/lib/theme'

const openSans = Open_Sans({ subsets: ['latin'], weight: ['400','500','600','700','800'] })

export const metadata = { title: 'HELM — Control Plane' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={openSans.className}>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  )
}
```

- [ ] **Step 6: Run test — expect PASS**

Run: `npm test -- theme`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: theme system + design tokens (dark-first + light)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Canonical types

**Files:**
- Create: `helm-app/lib/types.ts`, `helm-app/test/types.test.ts`

**Interfaces:**
- Produces: exported types `Tenant, Role, User, KpiMetric, MetricCell, ChannelRow, FunnelStage, CampaignRow, Agent, AgentTier, GatewayBudget, RoutingRow, ModelSplitRow, TrainingJob, PermissionRow, IntegrationRow, ActivityEvent, Flag`. Enum-like: `Role = 'master'|'agency'|'strategist'|'creative'|'analyst'|'viewer'`, `AgentTier = 'auto'|'propose'|'human'`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { KpiMetric, Role } from '@/lib/types'

describe('types', () => {
  it('KpiMetric shape compiles and constructs', () => {
    const k: KpiMetric = { label: 'CAC', value: '₹412', deltaLabel: '▲ 12%', direction: 'up', sparkline: [1,2,3], color: 'emerald' }
    expect(k.direction).toBe('up')
  })
  it('Role union', () => { const r: Role = 'master'; expect(r).toBe('master') })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- types`

- [ ] **Step 3: Implement types**

Create `helm-app/lib/types.ts` with the full type set. Include exactly:
```ts
export type Role = 'master' | 'agency' | 'strategist' | 'creative' | 'analyst' | 'viewer'
export type AgentTier = 'auto' | 'propose' | 'human'
export type Direction = 'up' | 'down' | 'flat'
export type SeriesColor = 'violet' | 'emerald' | 'sky' | 'amber' | 'rose'

export interface Tenant { id: string; name: string; region: string; env: string }
export interface User { id: string; name: string; email: string; role: Role; status: 'active' | 'invited' }

export interface KpiMetric { label: string; value: string; deltaLabel: string; direction: Direction; sparkline: number[]; color: SeriesColor }
export interface MetricCell { label: string; value: string; deltaLabel: string; direction: Direction }
export interface FunnelStage { label: string; value: number; display: string; widthPct: number; convLabel?: string }
export interface ChannelRow { name: string; color: SeriesColor; spend: number; checkups: number; cac: number; roas: number }
export interface CampaignRow { name: string; status: 'active' | 'review' | 'paused'; cac: number | null; pacingPct: number }

export interface Agent { code: string; name: string; role: string; tier: AgentTier; runs: string; success: string; tokens: string; cost: string; enabled: boolean; grad: [SeriesColor, SeriesColor] }
export interface GatewayBudget { provider: string; spent: number; cap: number }
export interface RoutingRow { task: string; model: string; calls: string; latency: string }
export interface ModelSplitRow { model: string; color: SeriesColor; tokens: string; pct: number }
export interface TrainingJob { model: string; type: string; status: 'running' | 'deployed' | 'queued' | 'shadow'; metric: string; progress: string }
export interface PermissionRow { capability: string; roles: Record<Role, 'yes' | 'no' | 'partial'> }
export interface IntegrationRow { name: string; auth: string; status: 'healthy' | 'degraded' | 'paused'; lastSync: string; calls: string; errors: number }
export interface ActivityEvent { agent: string; title: string; sub: string; dot: SeriesColor; latency: string; tokens: string; tag?: 'ERR' | 'REVIEW' }
export interface Flag { title: string; desc: string; on: boolean }
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- types`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: canonical prototype types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Format helpers

**Files:**
- Create: `helm-app/lib/format.ts`, `helm-app/test/format.test.ts`

**Interfaces:**
- Produces: `inr(n: number): string` (₹ + Indian K/L/Cr), `pct(n: number, digits?: number): string`, `compact(n: number): string` (K/L/Cr no ₹), `deltaDirection(current: number, prior: number, lowerIsBetter?: boolean): Direction`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { inr, pct, compact, deltaDirection } from '@/lib/format'

describe('format', () => {
  it('inr uses lakh/crore', () => {
    expect(inr(412)).toBe('₹412')
    expect(inr(496000)).toBe('₹4.96L')
    expect(inr(12000000)).toBe('₹1.20Cr')
  })
  it('compact', () => { expect(compact(2140000)).toBe('2.14M'); expect(compact(842000)).toBe('842K') })
  it('pct', () => { expect(pct(3.1)).toBe('3.10%') })
  it('deltaDirection respects lowerIsBetter', () => {
    expect(deltaDirection(412, 468, true)).toBe('up')   // CAC dropped -> good -> 'up'
    expect(deltaDirection(468, 412, true)).toBe('down')
    expect(deltaDirection(1204, 1112)).toBe('up')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- format`

- [ ] **Step 3: Implement**

Create `helm-app/lib/format.ts`:
```ts
import type { Direction } from './types'

export function compact(n: number): string {
  if (n >= 1e7) return (n / 1e7).toFixed(2) + 'Cr'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e5) return (n / 1e5).toFixed(2) + 'L'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}
export function inr(n: number): string {
  if (n < 1000) return '₹' + n
  return '₹' + compact(n)
}
export function pct(n: number, digits = 2): string { return n.toFixed(digits) + '%' }
export function deltaDirection(current: number, prior: number, lowerIsBetter = false): Direction {
  if (current === prior) return 'flat'
  const improved = lowerIsBetter ? current < prior : current > prior
  return improved ? 'up' : 'down'
}
```

Note: `compact(2140000)` → `2.14M`. Verify the test's `842K` (Math.round(842)=842) and `2.14M`.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- format`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: currency/number format helpers (INR, K/L/Cr, delta)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mock data + data service (the swap seam)

**Files:**
- Create: `helm-app/lib/data/mock/fixtures.ts`, `helm-app/lib/data/index.ts`, `helm-app/test/data.test.ts`

**Interfaces:**
- Consumes: all types from Task 3.
- Produces (async service — the seam a real BFF later implements):
  `getTenant(): Promise<Tenant>`, `getKpis(): Promise<KpiMetric[]>`, `getMetricStrip(): Promise<MetricCell[]>`, `getFunnel(): Promise<FunnelStage[]>`, `getChannels(): Promise<ChannelRow[]>`, `getCampaigns(): Promise<CampaignRow[]>`, `getActivity(): Promise<ActivityEvent[]>`, `getAgents(): Promise<Agent[]>`, `getGatewayBudgets(): Promise<GatewayBudget[]>`, `getRouting(): Promise<RoutingRow[]>`, `getModelSplit(): Promise<ModelSplitRow[]>`, `getTrainingJobs(): Promise<TrainingJob[]>`, `getPermissions(): Promise<PermissionRow[]>`, `getUsers(): Promise<User[]>`, `getIntegrations(): Promise<IntegrationRow[]>`, `getGuardrails(): Promise<Flag[]>`, `getFeatureFlags(): Promise<Flag[]>`.

- [ ] **Step 1: Write the failing test (reconciliation is the key invariant)**

Create `helm-app/test/data.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as data from '@/lib/data'

describe('mock data', () => {
  it('channel checkups sum to the funnel checkups stage', async () => {
    const channels = await data.getChannels()
    const funnel = await data.getFunnel()
    const channelTotal = channels.reduce((s, c) => s + c.checkups, 0)
    const checkupStage = funnel.find(f => f.label === 'Checkups')!
    expect(channelTotal).toBe(checkupStage.value)
  })
  it('exposes all 8 agents', async () => {
    expect((await data.getAgents()).length).toBe(8)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- data`

- [ ] **Step 3: Build fixtures**

Create `helm-app/lib/data/mock/fixtures.ts` porting the exact values shown in `helm-mockup-v4.html` into typed arrays. Channels MUST sum to 1204 (612+401+128+63) so the reconciliation test passes; funnel Checkups stage value = 1204. Include KPIs (4), metric strip (16 cells), funnel (5 stages), channels (4), campaigns (from mockup), activity (7 events), agents (8, matching mockup grads/tiers/stats), gateway budgets (4), routing (5), model split (5), training jobs (5), permissions (6 rows × 6 roles), users (5), integrations (7), guardrails (5), feature flags (5). Export each as a typed const.

- [ ] **Step 4: Build the service**

Create `helm-app/lib/data/index.ts`:
```ts
import * as fx from './mock/fixtures'
import type * as T from '../types'

const delay = <V>(v: V): Promise<V> => Promise.resolve(v) // seam: swap for fetch() later

export const getTenant = () => delay<T.Tenant>(fx.tenant)
export const getKpis = () => delay<T.KpiMetric[]>(fx.kpis)
export const getMetricStrip = () => delay<T.MetricCell[]>(fx.metricStrip)
export const getFunnel = () => delay<T.FunnelStage[]>(fx.funnel)
export const getChannels = () => delay<T.ChannelRow[]>(fx.channels)
export const getCampaigns = () => delay<T.CampaignRow[]>(fx.campaigns)
export const getActivity = () => delay<T.ActivityEvent[]>(fx.activity)
export const getAgents = () => delay<T.Agent[]>(fx.agents)
export const getGatewayBudgets = () => delay<T.GatewayBudget[]>(fx.gatewayBudgets)
export const getRouting = () => delay<T.RoutingRow[]>(fx.routing)
export const getModelSplit = () => delay<T.ModelSplitRow[]>(fx.modelSplit)
export const getTrainingJobs = () => delay<T.TrainingJob[]>(fx.trainingJobs)
export const getPermissions = () => delay<T.PermissionRow[]>(fx.permissions)
export const getUsers = () => delay<T.User[]>(fx.users)
export const getIntegrations = () => delay<T.IntegrationRow[]>(fx.integrations)
export const getGuardrails = () => delay<T.Flag[]>(fx.guardrails)
export const getFeatureFlags = () => delay<T.Flag[]>(fx.featureFlags)
```

- [ ] **Step 5: Run test — expect PASS** (fix fixture values until reconciliation holds)

Run: `npm test -- data`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: reconciled mock data behind swappable data service

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: RBAC + tenant context

**Files:**
- Create: `helm-app/lib/rbac.ts`, `helm-app/lib/tenant.tsx`, `helm-app/lib/nav.ts`, `helm-app/test/rbac.test.ts`

**Interfaces:**
- Consumes: `Role` (Task 3), `getTenant` (Task 5).
- Produces: `can(role: Role, cap: Capability): boolean`; `Capability = 'masterConsole'|'budgetShift'|'approveCreative'|'manageIntegrations'|'viewAnalytics'`; `NAV: NavItem[]` where `NavItem = { label: string; page: string; section: 'operate'|'master'; icon: string; cap?: Capability; badge?: number }`; `TenantProvider`, `useTenant()`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/rbac.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { can } from '@/lib/rbac'

describe('rbac', () => {
  it('only master sees the Master Console', () => {
    expect(can('master', 'masterConsole')).toBe(true)
    expect(can('agency', 'masterConsole')).toBe(false)
    expect(can('viewer', 'masterConsole')).toBe(false)
  })
  it('everyone can view analytics', () => {
    expect(can('viewer', 'viewAnalytics')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- rbac`

- [ ] **Step 3: Implement rbac**

Create `helm-app/lib/rbac.ts`:
```ts
import type { Role } from './types'
export type Capability = 'masterConsole' | 'budgetShift' | 'approveCreative' | 'manageIntegrations' | 'viewAnalytics'

const MATRIX: Record<Capability, Role[]> = {
  masterConsole: ['master'],
  budgetShift: ['master', 'agency', 'strategist'],
  approveCreative: ['master', 'agency', 'strategist', 'creative'],
  manageIntegrations: ['master', 'agency'],
  viewAnalytics: ['master', 'agency', 'strategist', 'creative', 'analyst', 'viewer'],
}
export const can = (role: Role, cap: Capability): boolean => MATRIX[cap].includes(role)
```

- [ ] **Step 4: Implement nav + tenant**

Create `helm-app/lib/nav.ts`:
```ts
import type { Capability } from './rbac'
export interface NavItem { label: string; page: string; section: 'operate' | 'master'; icon: string; cap?: Capability; badge?: number }
export const NAV: NavItem[] = [
  { label: 'Analytics', page: 'analytics', section: 'operate', icon: 'LayoutDashboard' },
  { label: 'Campaigns', page: 'campaigns', section: 'operate', icon: 'LineChart' },
  { label: 'Creative Studio', page: 'studio', section: 'operate', icon: 'Image' },
  { label: 'Workspace', page: 'workspace', section: 'operate', icon: 'MessageSquare' },
  { label: 'Integrations', page: 'integrations', section: 'operate', icon: 'Plug' },
  { label: 'Approvals', page: 'approvals', section: 'operate', icon: 'CheckCircle', badge: 3 },
  { label: 'Agent Fleet', page: 'agents', section: 'master', icon: 'Bot', cap: 'masterConsole' },
  { label: 'Model Gateway', page: 'gateway', section: 'master', icon: 'Globe', cap: 'masterConsole' },
  { label: 'Training & Evals', page: 'training', section: 'master', icon: 'GraduationCap', cap: 'masterConsole' },
  { label: 'Access & RBAC', page: 'rbac', section: 'master', icon: 'Users', cap: 'masterConsole' },
  { label: 'System Config', page: 'system', section: 'master', icon: 'Settings', cap: 'masterConsole' },
]
```

Create `helm-app/lib/tenant.tsx`:
```tsx
'use client'
import { createContext, useContext, ReactNode } from 'react'
import type { Tenant, Role } from './types'

const CURRENT: { tenant: Tenant; role: Role } = {
  tenant: { id: 'finnovate', name: 'Finnovate', region: 'ap-south-1', env: 'prod' },
  role: 'master',
}
const Ctx = createContext(CURRENT)
export function TenantProvider({ children }: { children: ReactNode }) { return <Ctx.Provider value={CURRENT}>{children}</Ctx.Provider> }
export const useTenant = () => useContext(Ctx)
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- rbac`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: RBAC capability map, nav definitions, tenant context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: UI primitives

**Files:**
- Create: `helm-app/components/ui/Button.tsx`, `Pill.tsx`, `StatusPill.tsx`, `Toggle.tsx`, `DeltaBadge.tsx`, `Card.tsx`, `EmptyState.tsx`, `SegControl.tsx`
- Create: `helm-app/test/ui.test.tsx`

**Interfaces:**
- Produces: `Button({ variant?: 'primary'|'ghost', children })` (pill), `Pill`, `StatusPill({ status })`, `Toggle({ on })`, `DeltaBadge({ direction, children })`, `Card`, `EmptyState({ icon, title, children })`, `SegControl({ options, value })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/ui.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'

describe('ui primitives', () => {
  it('Button renders children and is a button', () => {
    render(<Button>New Campaign</Button>)
    expect(screen.getByRole('button', { name: 'New Campaign' })).toBeInTheDocument()
  })
  it('StatusPill shows status text', () => {
    render(<StatusPill status="healthy" />)
    expect(screen.getByText('healthy')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- ui`

- [ ] **Step 3: Implement primitives**

Create each component porting the corresponding CSS classes from `helm-mockup-v4.html` (`.btn`, `.pill`, `.status`, `.toggle`, `.delta`/`.md`, `.card`, `.empty`, `.seg`) as className strings against the shared CSS variables (classes already exist in globals.css from Task 2, so components just apply them). Example `Button.tsx`:
```tsx
export function Button({ variant = 'ghost', children, ...p }: { variant?: 'primary' | 'ghost' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn${variant === 'primary' ? ' primary' : ''}`} {...p}>{children}</button>
}
```
`StatusPill.tsx`:
```tsx
const MAP = { healthy: 'on', active: 'on', degraded: 'rev', invited: 'rev', paused: 'off' } as const
export function StatusPill({ status }: { status: keyof typeof MAP }) {
  return <span className={`status ${MAP[status]}`}><i />{status}</span>
}
```
Implement the remaining primitives following the same port-the-class pattern.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- ui`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: pill-shaped UI primitives ported from v4 mockup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: App shell (sidebar + topbar), RBAC-gated

**Files:**
- Create: `helm-app/components/shell/Sidebar.tsx`, `TopBar.tsx`, `AppShell.tsx`
- Create: `helm-app/app/(app)/layout.tsx`, `helm-app/app/page.tsx`
- Create: `helm-app/test/shell.test.tsx`

**Interfaces:**
- Consumes: `NAV`, `can` (Task 6), `useTenant`, `useTheme`, icons from `lucide-react`.
- Produces: `AppShell({ children })` rendering sidebar + topbar + content; sidebar links are Next `<Link href={'/'+page}>` with active state from `usePathname()`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/shell.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { Sidebar } from '@/components/shell/Sidebar'

describe('sidebar', () => {
  it('shows Master Console items for master role', () => {
    render(<Sidebar role="master" />)
    expect(screen.getByText('Agent Fleet')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })
  it('hides Master Console items for viewer role', () => {
    render(<Sidebar role="viewer" />)
    expect(screen.queryByText('Agent Fleet')).not.toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- shell`

- [ ] **Step 3: Implement Sidebar**

Create `helm-app/components/shell/Sidebar.tsx` (client). Port `.side`, `.brand`, `.wsw`, `.role-chip`, `.nlabel`, `.nav` markup from v4. Render `NAV` filtered by `it => !it.cap || can(role, it.cap)`, grouped by `section` with the "Operate" / "Master Console" labels. Use `lucide-react` icons keyed by `it.icon`. Active state: `usePathname() === '/'+it.page`. Signature: `export function Sidebar({ role }: { role: Role })`.

- [ ] **Step 4: Implement TopBar + AppShell + layout + redirect**

`TopBar.tsx`: port `.top` (search pill, live indicator, theme toggle calling `useTheme().toggle`, notifications, primary Button). `AppShell.tsx`: `<div className="app"><Sidebar role={role}/><div className="main"><TopBar/>{children}</div></div>` using `useTenant().role`. `app/(app)/layout.tsx`: wrap children in `TenantProvider` + `AppShell`. `app/page.tsx`: `import { redirect } from 'next/navigation'; export default function Home(){ redirect('/analytics') }`.

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- shell`

- [ ] **Step 6: Verify visually**

Run: `npm run dev`, open `/analytics` (will 404 until Task 10 — confirm shell + sidebar render around the 404, or temporarily add an empty `analytics/page.tsx` returning `null`). Toggle theme; confirm dark and light both look correct. Stop server.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: RBAC-gated app shell (sidebar routing + topbar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Data-viz components

**Files:**
- Create under `helm-app/components/viz/`: `Sparkline.tsx`, `StatTile.tsx`, `TrendChart.tsx`, `FunnelChart.tsx`, `SplitBar.tsx`, `RadialGauge.tsx`, `Heatmap.tsx`, `DataTable.tsx`, `LiveActivityRail.tsx`, `AIInsightChip.tsx`, `AgentCard.tsx`, `PermissionMatrix.tsx`
- Create: `helm-app/test/viz.test.tsx`

**Interfaces:**
- Consumes: types (Task 3), format (Task 4).
- Produces: `StatTile({ metric: KpiMetric })`, `FunnelChart({ stages })`, `RadialGauge({ pct, color, label })`, `Heatmap({ rows })`, `DataTable({ columns, rows })`, `LiveActivityRail({ events })`, `AIInsightChip({ children })`, `AgentCard({ agent })`, `PermissionMatrix({ rows })`, `SplitBar({ segments })`, `TrendChart` (static SVG ported from v4), `Sparkline({ points, color })`.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/viz.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatTile } from '@/components/viz/StatTile'
import { RadialGauge } from '@/components/viz/RadialGauge'

describe('viz', () => {
  it('StatTile shows label, value, delta', () => {
    render(<StatTile metric={{ label: 'CAC', value: '₹412', deltaLabel: '▲ 12%', direction: 'up', sparkline: [1,2,1,3], color: 'emerald' }} />)
    expect(screen.getByText('CAC')).toBeInTheDocument()
    expect(screen.getByText('₹412')).toBeInTheDocument()
    expect(screen.getByText('▲ 12%')).toBeInTheDocument()
  })
  it('RadialGauge renders its percentage label', () => {
    render(<RadialGauge pct={81} color="emerald" label="CAC" />)
    expect(screen.getByText('81%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- viz`

- [ ] **Step 3: Implement viz components**

Port each from v4 markup/CSS. Key ones:
- `Sparkline`: `({ points, color }: { points: number[]; color: string })` → SVG polyline scaled to a 100×26 viewBox (normalize points to 0–26).
- `StatTile`: `.kpi` block — label, big value, `.kd` delta (class `up`/`down` from `metric.direction`), absolute `.fill` area sparkline using `metric.sparkline` + `metric.color`.
- `RadialGauge`: `.gauge` — SVG ring with `stroke-dashoffset = 201 * (1 - pct/100)`.
- `FunnelChart`, `SplitBar`, `Heatmap` (build from a `rows: number[][]` seed + the scale array), `DataTable` (generic `columns: {key,label,align?,render?}[]`), `LiveActivityRail`, `AIInsightChip` (sparkle svg + text), `AgentCard`, `PermissionMatrix` (renders `yes`→✓, `partial`→◐, `no`→·).
- `TrendChart`: port the static multi-series SVG from v4's Spend·Revenue·Checkups card.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- viz`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: data-viz component library (tiles, charts, gauges, tables)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Analytics page

**Files:**
- Create: `helm-app/app/(app)/analytics/page.tsx`, `helm-app/test/analytics.test.tsx`

**Interfaces:**
- Consumes: data service (Task 5), viz components (Task 9).

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/analytics.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AnalyticsPage from '@/app/(app)/analytics/page'

describe('analytics page', () => {
  it('renders KPI labels from data', async () => {
    render(await AnalyticsPage())
    expect(await screen.findByText('Cost per Checkup')).toBeInTheDocument()
    expect(screen.getByText('Live Activity')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- analytics`

- [ ] **Step 3: Implement the page (async server component)**

Create `helm-app/app/(app)/analytics/page.tsx` that awaits the data service and composes: `<PageHead>` + SegControl, KPI hero (`StatTile` × 4), metric strip (16 `MetricCell`), `.grid` of `TrendChart`+`AIInsightChip` and `LiveActivityRail`, then the bento (`FunnelChart`, Channel `SplitBar`+`DataTable`, `RadialGauge` ×3, `Heatmap`, Creative leaderboard, Approvals preview). Use exact section structure from v4's `data-page="analytics"`.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- analytics`

- [ ] **Step 5: Verify visually**

Run `npm run dev`, open `/analytics`. Compare against `helm-mockup-v4.html` Analytics view — layout should match in dark and light. Stop server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Analytics console page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Master Console pages (Agent Fleet, Gateway, Training, RBAC, System)

**Files:**
- Create: `helm-app/app/(app)/{agents,gateway,training,rbac,system}/page.tsx`
- Create: `helm-app/test/master.test.tsx`

**Interfaces:**
- Consumes: data service (Task 5), viz + ui components.

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/master.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentsPage from '@/app/(app)/agents/page'
import RbacPage from '@/app/(app)/rbac/page'

describe('master console', () => {
  it('agents page renders the kill switch and 8 agents', async () => {
    render(await AgentsPage())
    expect(await screen.findByText('Global Kill Switch')).toBeInTheDocument()
    expect(screen.getByText('Governor')).toBeInTheDocument()
  })
  it('rbac page renders the permission matrix', async () => {
    render(await RbacPage())
    expect(await screen.findByText('Permission Matrix')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- master`

- [ ] **Step 3: Implement the five pages**

Each is an async server component awaiting the relevant data service functions and composing the exact card layout from the matching `data-page` section in v4:
- `agents/page.tsx`: kill-switch banner + `AgentCard` grid from `getAgents()`.
- `gateway/page.tsx`: `getGatewayBudgets()` budgets, `getRouting()` table, `getModelSplit()` split, guardrail flags.
- `training/page.tsx`: `getTrainingJobs()` table + eval leaderboard.
- `rbac/page.tsx`: `PermissionMatrix` from `getPermissions()` + `getUsers()` table.
- `system/page.tsx`: `getGuardrails()` + `getFeatureFlags()` flag lists + `getIntegrations()` table.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- master`

- [ ] **Step 5: Verify visually**

Run `npm run dev`; click through all five Master Console items in the sidebar. Confirm routing + layout match v4. Stop server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Master Console pages (agents, gateway, training, rbac, system)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Operate placeholder pages

**Files:**
- Create: `helm-app/app/(app)/{campaigns,studio,workspace,integrations,approvals}/page.tsx`
- Create: `helm-app/test/placeholders.test.tsx`

**Interfaces:**
- Consumes: `EmptyState` (Task 7).

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/placeholders.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Campaigns from '@/app/(app)/campaigns/page'

describe('placeholders', () => {
  it('campaigns renders an EmptyState heading', () => {
    render(<Campaigns />)
    expect(screen.getByRole('heading', { name: /Campaigns/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- placeholders`

- [ ] **Step 3: Implement placeholders**

Each page renders `<PageHead>` + a `<Card>` with `<EmptyState>` using the exact copy from the matching v4 placeholder (e.g. Workspace mentions Gateway-routed chat + retrieval citations + prompt library). Keep them 6–10 lines each.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- placeholders`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wired Operate placeholder pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Responsive + a11y + full verification pass

**Files:**
- Modify: `helm-app/app/globals.css` (confirm responsive breakpoints ported), any component needing `aria-label`
- Create: `helm-app/test/a11y.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `helm-app/test/a11y.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }))
import { TopBar } from '@/components/shell/TopBar'

describe('a11y', () => {
  it('icon-only buttons have accessible names', () => {
    render(<TopBar />)
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL** (until `aria-label="Toggle theme"` added)

Run: `npm test -- a11y`

- [ ] **Step 3: Add aria-labels to icon-only buttons**

Add `aria-label` to the theme toggle, notifications, and any icon-only control in `TopBar`/`Sidebar`.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- a11y`

- [ ] **Step 5: Full suite + responsive check**

Run: `npm test` (all pass). Then `npm run dev`, and at widths 375 / 768 / 1024 / 1440 confirm: no horizontal scroll; sidebar/bento collapse per the `@media(max-width:1240px)` rules ported from v4; text ≥ readable size.

- [ ] **Step 6: Production build sanity**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: responsive + a11y pass; prototype verified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 visual direction → Tasks 2, 7, 9 (tokens, pill primitives, viz). ✓
- §4 data layer / types / tenant / rbac → Tasks 3, 5, 6. ✓
- §5 sidebar routing + RBAC gating → Tasks 6, 8. ✓
- §6.1 Analytics (all widgets) → Tasks 9, 10. ✓
- §6.6 Master Console (5 pages) → Task 11. ✓
- §6.2–6.5 Operate placeholders → Task 12. ✓
- §7 component list → Tasks 7, 9. ✓
- §8 success criteria (routing, themes, data discipline, reconciliation, responsive, pills, Open Sans) → Tasks 5 (reconciliation test), 8 (routing/gating test), 13 (responsive/a11y/build). ✓

**Placeholder scan:** No "TBD"/"handle edge cases". "Placeholder pages" (Task 12) are an intentional product deliverable with exact copy, not plan gaps. Component-port steps reference the exact source section in `helm-mockup-v4.html` rather than restating hundreds of lines of identical markup — this is DRY against a committed source file, not an omission.

**Type consistency:** Service function names in Task 5 (`getKpis`, `getChannels`, `getFunnel`, `getAgents`, `getPermissions`, …) are reused verbatim in Tasks 10–11. `KpiMetric`, `FunnelStage`, `Agent`, `PermissionRow` names consistent across Tasks 3, 9, 10, 11. `can`/`Capability` consistent across Tasks 6, 8. `Sidebar({ role })` signature consistent across Tasks 8, 13.

No gaps found.

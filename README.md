# HELM · Autonomous Marketing Operations Control Plane

HELM is a multi-tenant, AI-native marketing operations control plane and agent execution system designed for regulated financial advisory and growth campaigns. It integrates full-funnel campaign intelligence, generative creative production with deterministic compliance gates, grounded AI workspace analysis, and human-in-the-loop agent supervision — with complete tenant data isolation.

---

## Key Capabilities & Architecture

### 1. Global Shell & Navigation
- **Interactive Command Palette (`Ctrl + K` / `Cmd + K`)**: Global spotlight modal for instant fuzzy search across campaigns, agent actions (*Run Media Buyer, Generate Creatives, Ask Analyst*), navigation targets, and power tools.
- **Collapsible Navigation Rail**: Smooth minimize/maximize rail (`242px` $\leftrightarrow$ `68px`) with sleek custom scrollbars and floating capability hovercards for every module.
- **Contextual Campaign SlideOver**: 1-click `+ New Campaign` drawer to configure objectives, INR daily budgets, channels, and AI supervisor agents without context switching.

### 2. Multi-Agent Fleet Supervision (`/agents`)
- **Governor (`GV`)**: High-level workflow orchestration and policy delegation across sub-agents.
- **Media Buyer (`MB`)**: Daily ad budget rebalancing enforcing deterministic **$\pm 25\%$ shift caps** and budget conservation rules before execution.
- **Creative (`CR`)**: Generative ad copy deck writer with strict **SEBI Advertising Code** compliance verification.
- **Analyst (`AN`)**: Grounded data analysis and full-funnel metric synthesis.
- **Durable Checkpointing & Human-in-the-Loop (HITL)**: All autonomous actions pause at a checkpoint gate (powered by LangGraph + SQLite checkpointer) requiring human approval before dispatching live changes.
- **Visual Step Timeline & Delta Bars**: Real-time 5-step execution timeline (`Policy Init → Model Reasoning → Constraint Caps → HITL Checkpoint → Committed`) and color-coded budget reallocation magnitude bars.

### 3. Creative Studio with SEBI Gate (`/studio`)
- **Deterministic Compliance Verifier**: Automatically detects superlative claims, guaranteed return promises, or missing statutory risk disclosures under SEBI (Investment Advisers) Regulations, 2013.
- **Interactive SEBI Inspector**: View exact violation rationale and regulatory code citations.
- **1-Click AI Auto-Fix**: Automatically rephrases non-compliant headlines and body text into verified compliant variants.
- **Batch Deployment**: Ship all passing variants directly to live ad inventory.

### 4. Grounded AI Workspace (`/workspace`)
- **Line-Level Provenance Citations**: Every response is verified and grounded against sealed client documentation with interactive source chunk popovers.
- **Deep-Link Metric Drill-Downs**: Contextual *"Ask AI Analyst"* chips across the analytics dashboard deep-link directly into pre-populated workspace analysis threads.

### 5. Performance Overview & Mini-Approvals (`/analytics`)
- **Full-Funnel Intelligence**: Live KPI tiles, 30D spend pacing, revenue trajectory, ROAS, and CAC dispersion.
- **Interactive Heatmap**: Day $\times$ Hour conversion density with intensity tooltips.
- **Direct Mini-Approvals Widget**: 1-click Approve and Reject controls right on the performance dashboard.

---

## Directory Structure

| Directory | Description |
| :--- | :--- |
| `web/` | Next.js 16 App Router UI + BFF. Client-side authentication, RBAC capability checks, Command Palette, slide-overs, and server actions communicating with backend workers and gateway. |
| `api/` | FastAPI control plane — OIDC/JWT verification, tenant isolation, Postgres row-level security, append-only audit log, and Model Gateway completions adapter. |
| `workers/` | Async worker spine — LangGraph supervisor agents, deterministic policy guardrails, and SQLite checkpointing (`workers/.helm-worker/checkpoints.sqlite`). |
| `docs/` | Architectural specifications, security models, RBAC scopes, and live status documentation. |

---

## Quickstart & Local Setup

### 1. Web Frontend (Next.js)
```bash
cd web
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 2. FastAPI Backend & Model Gateway
```bash
cd api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app.main:app --port 8000 --reload
```

### 3. Running Live Agents via Worker CLI
```bash
# Example: Trigger Media Buyer in dry-run/live mode
cd workers
.venv/Scripts/python -m helm_worker buy --objective "Optimize CAC <= 400 for ₹999 checkup" --json
```

---

## Running Automated Tests

```bash
# Run web unit & integration tests (46 test files, 246 tests passing)
cd web
npm test

# Run API test suite
cd api
pytest
```

---

## Security & Compliance
- **Zero Raw Key Exposure**: Provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are isolated strictly to the Model Gateway. Worker child processes operate fail-closed.
- **Fail-Closed Gateways**: Token spend ledgers, daily budget ceilings, and global kill switches immediately prevent unauthorized egress.
- **Sanitized Approvals**: All human approval cards format clean, domain-specific regulatory prose without leaking raw serialization internals.

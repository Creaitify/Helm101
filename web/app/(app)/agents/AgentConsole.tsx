'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  executeAgent,
  decideAgent,
  inspectAgent,
  getModelConfig,
  setActiveModel,
  type AgentKind,
  type AgentActionResponse,
  type ModelConfig,
} from './actions'
import type { HandoffEnvelope } from '@/lib/types'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Play,
  RotateCw,
  Eye,
  FileCode,
  Layers,
  Sparkles,
  DollarSign,
  PenTool,
  BarChart3,
  Clock,
  ChevronRight,
  X,
  TrendingUp,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react'

interface AgentMeta {
  kind: AgentKind
  name: string
  code: string
  tagline: string
  description: string
  presets: string[]
  placeholder: string
}

const ROSTER: AgentMeta[] = [
  {
    kind: 'governor',
    name: 'Governor',
    code: 'GV',
    tagline: 'Multi-Agent Star Relay Supervisor',
    description: 'Orchestrates the canonical relay: Analyst (AN) ↔ Governor (GV) ↔ Creative (CR) ↔ Governor (GV) ↔ Media Buyer (MB) ↔ Governor (GV) ↔ HITL Gate.',
    presets: [
      'Orchestrate growth push for ₹999 Financial Health Checkup: audit 30D trends, draft SEBI-compliant copy variants, and rebalance daily budgets within ±25% caps.',
      'Lower blended CAC by 15% across all channels without reducing checkup volume.',
      'Audit channel performance and refresh ad copy to improve advisory conversion.',
    ],
    placeholder: 'Set your business objective — Governor will orchestrate the full relay',
  },
  {
    kind: 'media_buyer',
    name: 'Media Buyer',
    code: 'MB',
    tagline: 'Budget Optimization & Policy Gate',
    description: 'Reallocates ad campaign spend based on real-time CAC and ROAS, strictly enforcing ±25% shift caps and budget conservation.',
    presets: [
      'Lower blended CAC across Meta and Google sample campaigns.',
      'Shift daily budget to maximize Financial Health Checkup completions.',
      'Rebalance underperforming non-brand search into high-ROAS Meta retargeting.',
    ],
    placeholder: 'Describe your budget reallocation or CAC optimization goal...',
  },
  {
    kind: 'creative',
    name: 'Creative',
    code: 'CR',
    tagline: 'SEBI-Compliant Copy Production',
    description: 'Drafts multi-angle ad copy variants and enforces deterministic SEBI compliance rule checks (zero promised returns, clear risk disclosure).',
    presets: [
      'Create three honest variants for the ₹999 Financial Health Checkup for young professionals.',
      'Draft urgency-led and benefit-led ad copies for tax-planning portfolio reviews.',
      'Produce transparent advisory copy emphasizing certified advisor guidance.',
    ],
    placeholder: 'Enter a creative brief or target audience angle...',
  },
  {
    kind: 'analyst',
    name: 'Analyst',
    code: 'AN',
    tagline: 'Grounded Platform Intelligence',
    description: 'Answers architecture, compliance, and campaign intelligence questions strictly grounded in platform documentation with line-level citations.',
    presets: [
      'What blocks live sign-in and how do we resolve it?',
      'Summarize the SEBI regulatory guidelines in our knowledge corpus.',
      'What are the core capabilities and gates of the Model Gateway?',
    ],
    placeholder: 'Ask any question about platform architecture or campaign performance...',
  },
]

export function AgentConsole() {
  const searchParams = useSearchParams()
  const objectiveParam = searchParams?.get('objective')

  const [selectedAgent, setSelectedAgent] = useState<AgentMeta>(ROSTER[0])
  const [prompt, setPrompt] = useState(ROSTER[0].presets[0])
  const [result, setResult] = useState<AgentActionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [selectedEnvelope, setSelectedEnvelope] = useState<HandoffEnvelope | null>(null)
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)
  const [switchingModel, setSwitchingModel] = useState(false)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load the switchable model roster once
  useEffect(() => {
    let cancelled = false
    getModelConfig().then((cfg) => {
      if (!cancelled) setModelConfig(cfg)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleModelChange(modelId: string) {
    if (switchingModel) return
    setSwitchingModel(true)
    try {
      const cfg = await setActiveModel(modelId === '__default__' ? null : modelId)
      setModelConfig(cfg)
    } finally {
      setSwitchingModel(false)
    }
  }

  // Pre-fill objective from searchParams if navigated from Workspace
  useEffect(() => {
    if (objectiveParam) {
      const gov = ROSTER.find((a) => a.kind === 'governor') || ROSTER[0]
      setSelectedAgent(gov)
      setPrompt(objectiveParam)
    }
  }, [objectiveParam])

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // Short-polling for active runs
  useEffect(() => {
    if (result?.runId && result.status === 'running') {
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = setInterval(async () => {
        const updated = await inspectAgent(result.runId!)
        if (updated.ok) {
          setResult(updated)
          if (updated.status !== 'running') {
            if (pollingRef.current) clearInterval(pollingRef.current)
            pollingRef.current = null
          }
        }
      }, 1500)
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [result?.runId, result?.status])

  async function handleRun() {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setResult(null)
    setShowRejectInput(false)
    setSelectedEnvelope(null)
    try {
      const res = await executeAgent(selectedAgent.kind, prompt)
      setResult(res)
    } catch (err: any) {
      setResult({
        ok: false,
        status: 'failed',
        error: err?.message || 'Agent execution failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDecision(decision: 'approved' | 'rejected') {
    if (!result?.runId || deciding) return
    setDeciding(true)
    try {
      const res = await decideAgent(result.runId, decision, rejectReason)
      setResult(res)
      setShowRejectInput(false)
      setRejectReason('')
    } finally {
      setDeciding(false)
    }
  }

  function selectAgentTab(agent: AgentMeta) {
    setSelectedAgent(agent)
    setPrompt(agent.presets[0])
    setResult(null)
    setShowRejectInput(false)
    setSelectedEnvelope(null)
  }

  const state = result?.state || {}
  const isAwaiting = result?.isAwaitingApproval || result?.status === 'awaiting_approval'
  const hops: any[] = state.hops || []
  const isGovernor = selectedAgent.kind === 'governor' || (result?.runId && result.runId.startsWith('gv-'))

  // Calculate Relay step active states
  const hasAnalyst = hops.some((h) => h.from_agent === 'analyst')
  const hasCreative = hops.some((h) => h.from_agent === 'creative')
  const hasMediaBuyer = hops.some((h) => h.from_agent === 'media_buyer')
  const hasHitl = isAwaiting || result?.status === 'completed' || result?.status === 'rejected'

  return (
    <Card className="agent-console">
      <div className="card-h">
        <div>
          <h3>Run a live agent</h3>
          <div className="sub">
            Interactive Operations Console · Star Relay Topology · SQLite Envelopes & Audit Trail · Human-in-the-Loop Checkpoints
          </div>
        </div>
        <span className="pill v">
          <Cpu width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
          Durable Runtime Active
        </span>
      </div>

      {/* Agent Selector Tabs */}
      <div className="agent-tabs">
        {ROSTER.map((agent) => {
          const active = selectedAgent.kind === agent.kind
          return (
            <button
              key={agent.kind}
              type="button"
              className={active ? 'on' : ''}
              onClick={() => selectAgentTab(agent)}
            >
              <span className="agent-tab-code">{agent.code}</span>
              <div className="agent-tab-info">
                <b>{agent.name}</b>
                <small>{agent.tagline}</small>
              </div>
            </button>
          )
        })}
      </div>

      {/* Active Agent Description */}
      <div className="agent-desc-bar">
        <p>{selectedAgent.description}</p>
      </div>

      {/* Input / Execution Box */}
      <div className="agent-input-wrap">
        <div className="agent-preset-chips-wrap">
          <div className="preset-header-row">
            <span className="preset-label">Preset Objectives:</span>
            <span className="preset-hint">Click a template or customize your directive below</span>
          </div>
          <div className="agent-preset-chips">
            {selectedAgent.presets.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                className={`preset-chip-btn ${prompt === preset ? 'active' : ''}`}
                onClick={() => setPrompt(preset)}
                disabled={busy}
              >
                <div className="preset-chip-title">
                  <b>Preset {idx + 1}</b>
                  {prompt === preset && <span className="preset-chip-badge">Active</span>}
                </div>
                <span>{preset}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="agent-prompt-box">
          <div className="agent-prompt-header">
            <div className="agent-prompt-title">
              <Sparkles width={14} height={14} color="var(--violet-2)" />
              <span>{selectedAgent.kind === 'governor' ? 'Mission Directive & Target Parameters' : 'Task Prompt & Directive'}</span>
            </div>
            <div className="agent-prompt-actions">
              {prompt && !busy && (
                <button
                  type="button"
                  className="agent-prompt-clear-btn"
                  onClick={() => setPrompt('')}
                  title="Clear input"
                >
                  Clear
                </button>
              )}
              <span className="agent-prompt-charcount">{prompt.length} chars</span>
            </div>
          </div>

          <textarea
            className="agent-prompt-textarea"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={selectedAgent.placeholder}
            disabled={busy}
          />
        </div>

        <div className="agent-input-footer">
          <div className="agent-input-note">
            <ShieldCheck width={14} height={14} color="var(--emerald-2)" />
            <span>State checkpointed at every step. Model calls are never repeated on resume.</span>
          </div>
          {modelConfig && modelConfig.available.length > 0 && (
            <div className="agent-model-picker" title={
              modelConfig.active
                ? (modelConfig.available.find((m) => m.id === modelConfig.active)?.note || '')
                : 'Per-task defaults from the routing table (Sonnet for agents, Haiku for routing)'
            }>
              <Cpu width={13} height={13} style={{ opacity: 0.7 }} />
              <label htmlFor="agent-model-select" style={{ fontSize: 11, opacity: 0.75 }}>Model</label>
              <select
                id="agent-model-select"
                value={modelConfig.active ?? '__default__'}
                disabled={switchingModel || busy}
                onChange={(e) => handleModelChange(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6 }}
              >
                <option value="__default__">Auto (per-task default)</option>
                {modelConfig.available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · ${m.input_per_mtok_usd}/${m.output_per_mtok_usd} per MTok
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            variant="primary"
            className={`btn-agent-dispatch ${selectedAgent.kind === 'governor' ? 'btn-governor-dispatch' : ''}`}
            aria-label={`Start ${selectedAgent.name} Run · Dispatch Mission`}
            disabled={busy || !prompt.trim()}
            onClick={handleRun}
          >
            <Play width={14} height={14} />
            {busy
              ? (selectedAgent.kind === 'governor' ? 'Dispatching Mission…' : 'Running Graph…')
              : (selectedAgent.kind === 'governor' ? '🚀 Dispatch Mission' : `Start ${selectedAgent.name} Run`)}
          </Button>
        </div>
      </div>

      {/* Star Relay Stepper (for Governor Relay runs) */}
      {isGovernor && (busy || result) && (
        <div className="relay-stepper-wrap">
          <div className="relay-stepper-header">
            <span className="relay-title">
              <Layers width={14} height={14} style={{ display: 'inline', marginRight: 6 }} />
              Governor Star Topology Relay
            </span>
            <span className="relay-sub">AN ↔ GV ↔ CR ↔ GV ↔ MB ↔ GV ↔ HITL</span>
          </div>

          <div className="relay-steps">
            {/* Step 1: Analyst */}
            <div className={`relay-step-card ${hasAnalyst ? 'done' : busy ? 'active' : ''}`}>
              <div className="relay-step-icon">
                <BarChart3 width={16} height={16} />
              </div>
              <div className="relay-step-content">
                <b>1. Analyst Audit</b>
                <small>{hasAnalyst ? 'Findings passed' : busy ? 'Auditing trends…' : 'Pending'}</small>
              </div>
            </div>

            <div className="relay-arrow">↔</div>

            {/* Hub: Governor */}
            <div className="relay-step-card governor done">
              <div className="relay-step-icon">
                <ShieldCheck width={16} height={16} />
              </div>
              <div className="relay-step-content">
                <b>Governor Hub</b>
                <small>Orchestrating</small>
              </div>
            </div>

            <div className="relay-arrow">↔</div>

            {/* Step 2: Creative */}
            <div className={`relay-step-card ${hasCreative ? 'done' : hasAnalyst && busy ? 'active' : ''}`}>
              <div className="relay-step-icon">
                <PenTool width={16} height={16} />
              </div>
              <div className="relay-step-content">
                <b>2. Creative Copy</b>
                <small>{hasCreative ? 'SEBI passed' : hasAnalyst && busy ? 'Drafting…' : 'Pending'}</small>
              </div>
            </div>

            <div className="relay-arrow">↔</div>

            {/* Step 3: Media Buyer */}
            <div className={`relay-step-card ${hasMediaBuyer ? 'done' : hasCreative && busy ? 'active' : ''}`}>
              <div className="relay-step-icon">
                <DollarSign width={16} height={16} />
              </div>
              <div className="relay-step-content">
                <b>3. Media Buyer</b>
                <small>{hasMediaBuyer ? '±25% caps checked' : hasCreative && busy ? 'Optimizing…' : 'Pending'}</small>
              </div>
            </div>

            <div className="relay-arrow">→</div>

            {/* Step 4: HITL Gate */}
            <div className={`relay-step-card hitl ${hasHitl ? (isAwaiting ? 'active' : 'done') : ''}`}>
              <div className="relay-step-icon">
                <Cpu width={16} height={16} />
              </div>
              <div className="relay-step-content">
                <b>4. HITL Gate</b>
                <small>{isAwaiting ? 'Decision needed' : result?.status === 'completed' ? 'Approved' : result?.status === 'rejected' ? 'Rejected' : 'Pending'}</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Execution Results View */}
      {result && (
        <div className="agent-result-panel">
          {/* Status Bar */}
          <div className="agent-status-bar">
            <div className="agent-run-id">
              <span>Run ID:</span>
              <code>{result.runId}</code>
            </div>
            <div className="agent-status-tag">
              {result.status === 'awaiting_approval' && (
                <span className="pill w">
                  <AlertTriangle width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
                  Awaiting Operator Approval
                </span>
              )}
              {result.status === 'completed' && (
                <span className="pill g">
                  <CheckCircle2 width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
                  Completed
                </span>
              )}
              {result.status === 'rejected' && (
                <span className="pill r">
                  <XCircle width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
                  Rejected by Human
                </span>
              )}
              {(result.status === 'failed' || (!result.ok && result.error)) && (
                <span className="pill r">
                  <XCircle width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
                  Failed: {result.error || state.error_code || 'Execution failed'}
                </span>
              )}
              {result.status === 'running' && (
                <span className="pill v">
                  <RotateCw width={12} height={12} className="spin" style={{ display: 'inline', marginRight: 4 }} />
                  Executing
                </span>
              )}
            </div>
          </div>

          {/* Chronological Relay Hops Feed */}
          {hops.length > 0 && (
            <div className="relay-hops-feed">
              <div className="relay-hops-feed-title">
                <Clock width={13} height={13} style={{ display: 'inline', marginRight: 6 }} />
                Chronological Relay Envelopes ({hops.length} hops logged)
              </div>
              <div className="relay-hops-list">
                {hops.map((hop: any, idx: number) => {
                  return (
                    <div
                      key={idx}
                      className={`relay-hop-row ${hop.verdict}`}
                      onClick={() =>
                        setSelectedEnvelope({
                          hopIndex: hop.hop_index ?? idx,
                          fromAgent: hop.from_agent,
                          toAgent: hop.to_agent,
                          hopKind: hop.hop_kind,
                          runId: hop.run_id,
                          tenantId: hop.tenant_id,
                          schemaVersion: hop.schema_version,
                          summary: hop.summary,
                          payload: hop.payload || {},
                          governorRationale: hop.governor_rationale,
                          verdict: hop.verdict,
                          tokensIn: hop.tokens_in,
                          tokensOut: hop.tokens_out,
                          costMicros: hop.estimated_cost_micros,
                          createdAt: hop.ts,
                        })
                      }
                    >
                      <div className="relay-hop-left">
                        <span className="relay-hop-idx">#{hop.hop_index ?? idx}</span>
                        <span className="relay-hop-agents">
                          <b className="agent-badge">{hop.from_agent?.toUpperCase()}</b>
                          <ArrowRight width={12} height={12} style={{ opacity: 0.5 }} />
                          <b className="agent-badge">{hop.to_agent?.toUpperCase()}</b>
                        </span>
                        <span className="relay-hop-kind">{hop.hop_kind}</span>
                      </div>
                      <div className="relay-hop-summary">{hop.summary}</div>
                      <div className="relay-hop-right">
                        <span className={`pill-micro ${hop.verdict}`}>{hop.verdict}</span>
                        <button type="button" className="btn-inspect">
                          <Eye width={12} height={12} style={{ marginRight: 4 }} />
                          Inspect
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* HITL Gate Decision Card */}
          {isAwaiting && result.interruptPayload && (
            <div className="hitl-decision-card">
              <div className="hitl-header">
                <div className="hitl-header-left">
                  <div className="hitl-badge-icon">
                    <ShieldCheck width={20} height={20} color="var(--amber-2)" />
                  </div>
                  <div>
                    <h4>Human Authorization Required</h4>
                    <span className="hitl-sub">Pausing at checkpoint — state preserved in checkpointer database.</span>
                  </div>
                </div>
                <Link href="/approvals" className="hitl-open-approvals-chip" title="Inspect full audit record in Approvals">
                  <span>Approvals Hub</span>
                  <ExternalLink width={12} height={12} />
                </Link>
              </div>

              <div className="hitl-body">
                {/* Executive Summary */}
                <div className="hitl-summary-box">
                  <div className="hitl-box-header">
                    <Sparkles width={13} height={13} color="var(--violet-2)" />
                    <b>Proposal Summary:</b>
                  </div>
                  <p>{result.interruptPayload.summary || result.interruptPayload.action}</p>
                </div>

                {/* Proposed Daily Budget Shifts Table */}
                {result.interruptPayload.shifts && result.interruptPayload.shifts.length > 0 && (
                  <div className="hitl-shifts-preview">
                    <div className="preview-header-bar">
                      <div className="preview-label-group">
                        <DollarSign width={14} height={14} color="var(--emerald-2)" />
                        <span className="preview-label">Proposed Daily Budget Shifts:</span>
                      </div>
                      <span className="policy-caps-tag">±25% Policy Caps Verified</span>
                    </div>

                    <div className="shifts-table">
                      <div className="shifts-table-head">
                        <span>Campaign ID</span>
                        <span>Current</span>
                        <span>Proposed</span>
                        <span>Shift Delta</span>
                        <span>Optimization Rationale</span>
                      </div>
                      {result.interruptPayload.shifts.map((s: any, idx: number) => {
                        const cur = Number(s.current_budget) || 0
                        const prop = Number(s.proposed_budget) || 0
                        const delta = prop - cur
                        const pct = cur > 0 ? (delta / cur) * 100 : 0
                        const isUp = delta > 0

                        return (
                          <div key={idx} className="shift-row">
                            <div className="shift-id-cell">
                              <span className="channel-tag">{s.campaign_id.includes('meta') ? 'Meta' : 'Google'}</span>
                              <span className="shift-id">{s.campaign_id}</span>
                            </div>
                            <div className="shift-num-cell">
                              ₹{cur.toLocaleString('en-IN')}
                            </div>
                            <div className="shift-num-cell proposed">
                              ₹{prop.toLocaleString('en-IN')}
                            </div>
                            <div className="shift-delta-cell">
                              <span className={`delta-badge ${isUp ? 'up' : 'down'}`}>
                                {isUp ? '+' : ''}₹{Math.abs(delta).toLocaleString('en-IN')} ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="shift-reason-cell">
                              {s.reason}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Compliant Copy Variants */}
                {result.interruptPayload.variants && result.interruptPayload.variants.length > 0 && (
                  <div className="hitl-variants-preview">
                    <div className="preview-header-bar">
                      <div className="preview-label-group">
                        <PenTool width={14} height={14} color="var(--violet-2)" />
                        <span className="preview-label">Compliant Copy Variants:</span>
                      </div>
                      <Link href="/studio" className="preview-studio-link">
                        Open in Creative Studio <ExternalLink width={11} height={11} style={{ display: 'inline', marginLeft: 3 }} />
                      </Link>
                    </div>

                    <div className="variants-grid">
                      {result.interruptPayload.variants.map((v: any, idx: number) => (
                        <div key={idx} className="variant-card">
                          <div className="variant-card-head">
                            <span className="variant-num">Variant {idx + 1}</span>
                            <span className="pill-micro pass">SEBI pass</span>
                          </div>
                          <b className="variant-title">{v.headline}</b>
                          <p className="variant-body">{v.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Policy Checks Badges Matrix */}
                {result.interruptPayload.checks && (
                  <div className="hitl-checks-section">
                    <span className="checks-heading">Deterministic Policy Verification:</span>
                    <div className="hitl-checks-grid">
                      {result.interruptPayload.checks.map((chk: any, idx: number) => (
                        <div key={idx} className={`check-card ${chk.status || 'pass'}`}>
                          <div className="check-card-left">
                            <CheckCircle2 width={14} height={14} color="var(--emerald-2)" />
                            <span className="check-card-label">{chk.label}</span>
                          </div>
                          <span className={`check-card-status ${chk.status || 'pass'}`}>
                            {chk.status === 'clamped' ? 'Clamped' : chk.status === 'flagged' ? 'Flagged' : 'Pass'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cross-Platform Hand-off Cards */}
                <div className="cross-platform-hand-off">
                  <span className="hand-off-title">
                    <Layers width={13} height={13} color="var(--violet-2)" />
                    Cross-Platform Workflow Hand-off:
                  </span>
                  <div className="hand-off-cards">
                    <Link href="/approvals" className="hand-off-card">
                      <div className="hand-off-card-icon">📋</div>
                      <div className="hand-off-card-content">
                        <b>Approvals Queue</b>
                        <span>Authorize multi-agent proposals alongside team approvals</span>
                      </div>
                      <ChevronRight width={14} height={14} className="hand-off-arrow" />
                    </Link>

                    <Link href="/studio" className="hand-off-card">
                      <div className="hand-off-card-icon">🎨</div>
                      <div className="hand-off-card-content">
                        <b>Creative Studio</b>
                        <span>Edit copy cards & ship directly to Meta/Google ad inventory</span>
                      </div>
                      <ChevronRight width={14} height={14} className="hand-off-arrow" />
                    </Link>

                    <Link href="/analytics" className="hand-off-card">
                      <div className="hand-off-card-icon">📊</div>
                      <div className="hand-off-card-content">
                        <b>Analytics Dashboard</b>
                        <span>Track live ROAS, spend pacing & blended CAC curves</span>
                      </div>
                      <ChevronRight width={14} height={14} className="hand-off-arrow" />
                    </Link>
                  </div>
                </div>
              </div>

              {/* Decision Action Buttons */}
              <div className="hitl-footer">
                {!showRejectInput ? (
                  <div className="hitl-actions">
                    <Button
                      variant="primary"
                      className="btn-approve-execute"
                      disabled={deciding}
                      onClick={() => handleDecision('approved')}
                    >
                      <CheckCircle2 width={16} height={16} />
                      {deciding ? 'Authorizing…' : 'Approve & Execute'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={deciding}
                      onClick={() => setShowRejectInput(true)}
                    >
                      <XCircle width={15} height={15} />
                      Reject Proposal
                    </Button>
                  </div>
                ) : (
                  <div className="hitl-reject-box">
                    <input
                      type="text"
                      placeholder="Enter reason for rejection (optional)..."
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="hitl-reject-btns">
                      <Button
                        variant="primary"
                        disabled={deciding}
                        onClick={() => handleDecision('rejected')}
                      >
                        Confirm Rejection
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowRejectInput(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="hitl-approvals-link-wrap">
                  <Link href="/approvals" className="hitl-approvals-link">
                    📋 View in Approvals →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Execution Log if Completed */}
          {state.execution_log && state.execution_log.length > 0 && (
            <div className="execution-log-box">
              <span className="log-title">Execution Audit Log:</span>
              <ul>
                {state.execution_log.map((log: string, idx: number) => (
                  <li key={idx}>{log}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Per-Hop Handoff Envelope Inspector Drawer */}
      {selectedEnvelope && (
        <div className="cmd-palette-backdrop" onClick={() => setSelectedEnvelope(null)}>
          <div className="envelope-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="envelope-drawer-header">
              <div className="envelope-title-wrap">
                <FileCode width={16} height={16} color="var(--violet-2)" />
                <h4>Handoff Envelope · Hop #{selectedEnvelope.hopIndex}</h4>
              </div>
              <button className="ibtn" onClick={() => setSelectedEnvelope(null)} aria-label="Close inspector">
                <X width={16} height={16} />
              </button>
            </div>

            <div className="envelope-meta-grid">
              <div className="meta-cell">
                <label>Route</label>
                <div>
                  <b className="agent-badge">{selectedEnvelope.fromAgent.toUpperCase()}</b>
                  <ArrowRight width={12} height={12} style={{ display: 'inline', margin: '0 4px', opacity: 0.6 }} />
                  <b className="agent-badge">{selectedEnvelope.toAgent.toUpperCase()}</b>
                </div>
              </div>

              <div className="meta-cell">
                <label>Hop Kind</label>
                <div><code>{selectedEnvelope.hopKind}</code></div>
              </div>

              <div className="meta-cell">
                <label>Verdict</label>
                <div><span className={`pill-micro ${selectedEnvelope.verdict}`}>{selectedEnvelope.verdict}</span></div>
              </div>

              <div className="meta-cell">
                <label>Schema Version</label>
                <div><code>{selectedEnvelope.schemaVersion || '1.0.0'}</code></div>
              </div>
            </div>

            <div className="envelope-section">
              <label>Governor Rationale & Direction:</label>
              <div className="rationale-box">{selectedEnvelope.governorRationale || 'Evaluated and forwarded.'}</div>
            </div>

            <div className="envelope-section">
              <label>Typed Payload Object (Discriminated JSON):</label>
              <pre className="payload-json">{JSON.stringify(selectedEnvelope.payload, null, 2)}</pre>
            </div>

            <div className="envelope-drawer-footer">
              <button className="btn" onClick={() => setSelectedEnvelope(null)}>Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

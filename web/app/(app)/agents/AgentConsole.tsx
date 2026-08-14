'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { executeAgent, decideAgent, inspectAgent, type AgentKind, type AgentActionResponse } from './actions'
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

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

      {/* Active Agent Header & Presets */}
      <div className="agent-meta-banner">
        <p>{selectedAgent.description}</p>
        <div className="agent-presets">
          <span className="agent-presets-label">Preset goals:</span>
          {selectedAgent.presets.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              className="agent-preset-chip"
              onClick={() => setPrompt(preset)}
            >
              {preset.length > 55 ? `${preset.slice(0, 55)}…` : preset}
            </button>
          ))}
        </div>
      </div>

      {/* Input / Execution Box */}
      <div className="agent-input-wrap">
        {selectedAgent.kind === 'governor' && (
          <div className="agent-preset-chips-wrap">
            <span className="preset-label">Preset Objectives:</span>
            <div className="agent-preset-chips">
              {selectedAgent.presets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`preset-chip-btn ${prompt === preset ? 'active' : ''}`}
                  onClick={() => setPrompt(preset)}
                >
                  <b>Preset {idx + 1}</b>
                  <span>{preset}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={selectedAgent.placeholder}
          disabled={busy}
        />
        <div className="agent-input-footer">
          <div className="agent-input-note">
            <ShieldCheck width={14} height={14} color="var(--emerald-2)" />
            <span>State checkpointed at every step. Model calls are never repeated on resume.</span>
          </div>
          <Button
            variant="primary"
            className={selectedAgent.kind === 'governor' ? 'btn-governor-dispatch' : ''}
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
                <div className="hitl-title">
                  <ShieldCheck width={18} height={18} color="var(--amber-2)" />
                  <h4>Human Authorization Required</h4>
                </div>
                <span className="hitl-sub">Pausing at checkpoint — state preserved in checkpointer database.</span>
              </div>

              <div className="hitl-body">
                <div className="hitl-summary-box">
                  <b>Proposal Summary:</b>
                  <p>{result.interruptPayload.summary || result.interruptPayload.action}</p>
                </div>

                {/* Shifts Preview if Media Buyer or Relay */}
                {result.interruptPayload.shifts && result.interruptPayload.shifts.length > 0 && (
                  <div className="hitl-shifts-preview">
                    <span className="preview-label">Proposed Daily Budget Shifts:</span>
                    <div className="shifts-table">
                      {result.interruptPayload.shifts.map((s: any, idx: number) => (
                        <div key={idx} className="shift-row">
                          <span className="shift-id">{s.campaign_id}</span>
                          <span className="shift-nums">
                            ₹{Number(s.current_budget).toLocaleString()} → <b>₹{Number(s.proposed_budget).toLocaleString()}</b>
                          </span>
                          <span className="shift-reason">{s.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Variants Preview if Creative or Relay */}
                {result.interruptPayload.variants && result.interruptPayload.variants.length > 0 && (
                  <div className="hitl-variants-preview">
                    <span className="preview-label">Compliant Copy Variants:</span>
                    <div className="variants-list">
                      {result.interruptPayload.variants.map((v: any, idx: number) => (
                        <div key={idx} className="variant-box">
                          <b>{v.headline}</b>
                          <p>{v.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Policy Checks Badges */}
                {result.interruptPayload.checks && (
                  <div className="hitl-checks">
                    {result.interruptPayload.checks.map((chk: any, idx: number) => (
                      <span key={idx} className="check-badge pass">
                        <CheckCircle2 width={12} height={12} />
                        {chk.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

                {/* Decision Action Buttons */}
                <div className="hitl-footer">
                  {!showRejectInput ? (
                    <div className="hitl-actions">
                      <Button
                        variant="primary"
                        disabled={deciding}
                        onClick={() => handleDecision('approved')}
                      >
                        <CheckCircle2 width={15} height={15} />
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

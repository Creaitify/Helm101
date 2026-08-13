'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { executeAgent, decideAgent, type AgentKind, type AgentActionResponse } from './actions'
import { CheckCircle2, XCircle, AlertTriangle, ArrowRight, ShieldCheck, Cpu, Play } from 'lucide-react'

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
    tagline: 'Multi-Agent Supervisor',
    description: 'Deconstructs broad growth objectives into structured delegations across the agent fleet and coordinates child runs.',
    presets: [
      'Lower blended CAC by 15% across all channels without reducing checkup volume.',
      'Coordinate full push for the ₹999 Financial Health Checkup across Creative and Media teams.',
      'Audit channel performance and refresh ad copy to improve advisory conversion.',
    ],
    placeholder: 'Enter a strategic objective for the Governor to plan and delegate...',
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
  const [selectedAgent, setSelectedAgent] = useState<AgentMeta>(ROSTER[0])
  const [prompt, setPrompt] = useState(ROSTER[0].presets[0])
  const [result, setResult] = useState<AgentActionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)

  async function handleRun() {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setResult(null)
    setShowRejectInput(false)
    try {
      const res = await executeAgent(selectedAgent.kind, prompt)
      setResult(res)
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
  }

  const state = result?.state || {}
  const isAwaiting = result?.isAwaitingApproval || result?.status === 'awaiting_approval'

  return (
    <Card className="agent-console">
      <div className="card-h">
        <div>
          <h3>Run a live agent</h3>
          <div className="sub">
            Interactive Operations Console · Trigger durable LangGraph workflows through the FastAPI Gateway · Checkpointed in SQLite
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

      <div className="agent-desc-bar">
        <p>{selectedAgent.description}</p>
      </div>

      {/* Quick Prompt Presets */}
      <div className="agent-presets">
        <span className="preset-label">Suggested Goals:</span>
        <div className="preset-pills">
          {selectedAgent.presets.map((p, i) => (
            <button key={i} type="button" className="preset-pill" onClick={() => setPrompt(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Input Area */}
      <textarea
        className="agent-prompt"
        value={prompt}
        rows={3}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={selectedAgent.placeholder}
      />

      <div className="agent-console-foot">
        <span className="sub">
          <ShieldCheck width={14} height={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          All actions require explicit human sign-off before durable execution.
        </span>
        <Button variant="primary" onClick={handleRun} disabled={busy || !prompt.trim()}>
          {busy ? (
            'Executing Agent Graph…'
          ) : (
            <>
              <Play width={13} height={13} />
              Run {selectedAgent.name}
            </>
          )}
        </Button>
      </div>

      {/* Results View */}
      {result && (
        <div className="agent-result-box">
          {result.ok ? (
            <div className="agent-result-content">
              {/* Step Progression Timeline */}
              <div className="agent-step-timeline">
                <div className="timeline-line">
                  <div
                    className="timeline-line-fill"
                    style={{ width: isAwaiting ? '75%' : '100%' }}
                  />
                </div>
                <div className="timeline-step-node">
                  <div className="step-circle done">1</div>
                  <span className="step-label">Policy Init</span>
                </div>
                <div className="timeline-step-node">
                  <div className="step-circle done">2</div>
                  <span className="step-label">Model Reasoning</span>
                </div>
                <div className="timeline-step-node">
                  <div className="step-circle done">3</div>
                  <span className="step-label">Constraint Caps</span>
                </div>
                <div className="timeline-step-node">
                  <div className={`step-circle ${isAwaiting ? 'active' : 'done'}`}>4</div>
                  <span className="step-label">{isAwaiting ? 'HITL Checkpoint' : 'Gate Passed'}</span>
                </div>
                <div className="timeline-step-node">
                  <div className={`step-circle ${isAwaiting ? '' : 'done'}`}>5</div>
                  <span className="step-label">{isAwaiting ? 'Resume Execution' : 'Committed'}</span>
                </div>
              </div>

              {/* Header */}
              <div className="result-head">
                <div className="result-status-pill">
                  {isAwaiting ? (
                    <span className="status rev">
                      <i />
                      Awaiting Human Approval
                    </span>
                  ) : (
                    <span className="status on">
                      <i />
                      {result.status || 'Completed'}
                    </span>
                  )}
                </div>
                <div className="result-meta">
                  <span>Run ID: <code>{result.runId}</code></span>
                  {state.model_calls !== undefined && <span>· Model Calls: {state.model_calls}</span>}
                </div>
              </div>

              {/* In-Console Human Decision Banner */}
              {isAwaiting && (
                <div className="hitl-banner">
                  <div className="hitl-info">
                    <AlertTriangle width={20} height={20} color="var(--amber)" />
                    <div>
                      <b>Action Gated: Human Decision Required</b>
                      <p>
                        {result.interruptPayload?.summary ||
                          'The agent has prepared a proposal and paused at its checkpoint. Approve to resume execution or reject with rationale.'}
                      </p>
                    </div>
                  </div>

                  {showRejectInput ? (
                    <div className="reject-form">
                      <input
                        type="text"
                        placeholder="Reason for rejection (optional)..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="reject-actions">
                        <Button onClick={() => handleDecision('rejected')} disabled={deciding}>
                          Confirm Reject
                        </Button>
                        <Button onClick={() => setShowRejectInput(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="hitl-actions">
                      <Button variant="primary" onClick={() => handleDecision('approved')} disabled={deciding}>
                        <CheckCircle2 width={14} height={14} />
                        {deciding ? 'Resuming…' : 'Approve & Execute'}
                      </Button>
                      <Button onClick={() => setShowRejectInput(true)} disabled={deciding}>
                        <XCircle width={14} height={14} />
                        Reject Proposal
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Agent Specific Viewers */}
              {/* 1. MEDIA BUYER */}
              {selectedAgent.kind === 'media_buyer' && (
                <div className="agent-structured-view">
                  {state.analysis && (
                    <div className="analysis-card">
                      <h4>Strategic Analysis</h4>
                      <p>{state.analysis}</p>
                    </div>
                  )}

                  {Array.isArray(state.shifts) && state.shifts.length > 0 && (
                    <div className="shifts-section">
                      <h4>Proposed Budget Shifts (Enforced in Code)</h4>
                      <div className="shifts-table">
                        <div className="shifts-thead">
                          <span>Campaign</span>
                          <span>Current</span>
                          <span>Proposed</span>
                          <span>Shift Reason</span>
                        </div>
                        {state.shifts.map((s: any, idx: number) => {
                          const curr = Number(s.current_budget) || 0
                          const prop = Number(s.proposed_budget) || 0
                          const diff = prop - curr
                          const diffPct = curr ? ((diff / curr) * 100).toFixed(1) : '0'
                          const isUp = diff > 0
                          const maxBudget = 60000
                          const currPct = Math.min(100, Math.max(10, (curr / maxBudget) * 100))
                          const propPct = Math.min(100, Math.max(10, (prop / maxBudget) * 100))
                          return (
                            <div key={idx} className="shifts-trow">
                              <span className="shift-camp">
                                <b>{s.campaign_id}</b>
                                <div className="delta-bar-wrap">
                                  <div className="delta-bar-track">
                                    <div
                                      className={`delta-bar-fill ${isUp ? 'up' : 'down'}`}
                                      style={{ width: `${propPct}%` }}
                                    />
                                  </div>
                                </div>
                              </span>
                              <span className="mono">₹{curr.toLocaleString()}</span>
                              <span className="mono shift-prop">
                                ₹{prop.toLocaleString()}{' '}
                                <small className={isUp ? 'good' : 'bad'}>
                                  ({isUp ? `+${diffPct}%` : `${diffPct}%`})
                                </small>
                              </span>
                              <span className="shift-reason">{s.reason}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 2. CREATIVE */}
              {selectedAgent.kind === 'creative' && (
                <div className="agent-structured-view">
                  <h4>SEBI-Checked Creative Variants</h4>
                  <div className="creative-variants-list">
                    {Array.isArray(state.variants) &&
                      state.variants.map((v: any, idx: number) => {
                        const verdict = state.verdicts?.[idx] || { status: 'pass' }
                        const isPass = verdict.status === 'pass'
                        const isFlag = verdict.status === 'flag'
                        return (
                          <div key={idx} className={`creative-card ${verdict.status}`}>
                            <div className="creative-head">
                              <span className="variant-num">Variant #{idx + 1}</span>
                              <span className={`compliance-badge ${verdict.status}`}>
                                {isPass ? 'SEBI Pass' : isFlag ? 'SEBI Flagged' : 'Blocked'}
                              </span>
                            </div>
                            <h5>{v.headline}</h5>
                            <p>{v.body}</p>
                            {verdict.matched && (
                              <div className="rule-match">
                                <b>Matched Rule:</b> {verdict.matched}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* 3. GOVERNOR */}
              {selectedAgent.kind === 'governor' && (
                <div className="agent-structured-view">
                  {state.plan_summary && (
                    <div className="analysis-card">
                      <h4>Delegation Plan Summary</h4>
                      <p>{state.plan_summary}</p>
                    </div>
                  )}

                  {Array.isArray(state.delegations) && state.delegations.length > 0 && (
                    <div className="delegations-list">
                      <h4>Dispatched Sub-Tasks</h4>
                      <div className="delegation-grid">
                        {state.delegations.map((d: any, idx: number) => (
                          <div key={idx} className="delegation-card">
                            <div className="delegation-head">
                              <span className="delegation-agent-tag">{d.agent}</span>
                            </div>
                            <b>{d.task}</b>
                            <p>{d.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(state.children) && state.children.length > 0 && (
                    <div className="children-list">
                      <h4>Active Child Runs</h4>
                      {state.children.map((c: any, idx: number) => (
                        <div key={idx} className="child-run-chip">
                          <span>{c.agent}</span>
                          <ArrowRight width={12} height={12} />
                          <code>{c.run_id}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 4. ANALYST */}
              {selectedAgent.kind === 'analyst' && (
                <div className="agent-structured-view">
                  {state.answer && (
                    <div className="analysis-card">
                      <h4>Grounded Response</h4>
                      <div className="analyst-answer">{state.answer}</div>
                    </div>
                  )}

                  {Array.isArray(state.citations) && state.citations.length > 0 && (
                    <div className="citations-list">
                      <h4>Verified Documentation Citations ({state.citations.length})</h4>
                      <div className="citations-grid">
                        {state.citations.map((c: any, idx: number) => (
                          <div key={idx} className="citation-card">
                            <span className="cit-doc">{c.doc}:{c.start_line}</span>
                            <b className="cit-head">{c.heading}</b>
                            {c.quote && <p className="cit-quote">&ldquo;{c.quote}&rdquo;</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Execution Log */}
              {Array.isArray(state.execution_log) && state.execution_log.length > 0 && (
                <div className="execution-log">
                  <h4>Execution Receipts</h4>
                  <ul>
                    {state.execution_log.map((entry: string, i: number) => (
                      <li key={i}>{entry}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="agent-error-box">
              <XCircle width={18} height={18} color="var(--bad)" />
              <span>{result.error || 'An error occurred during agent execution.'}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

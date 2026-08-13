'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { runAgent, type AgentRunResult } from './actions'

const AGENTS = [
  { task: 'governor.plan', name: 'Governor', description: 'Break an objective into an approved delegation plan.', placeholder: 'Lower blended CAC without reducing checkup volume.' },
  { task: 'media_buyer.proposal', name: 'Media Buyer', description: 'Recommend budget shifts from a campaign snapshot.', placeholder: 'Paste a campaign snapshot and optimization objective.' },
  { task: 'creative.variants', name: 'Creative', description: 'Draft variants from a brief; compliance stays in code.', placeholder: 'Create three honest variants for the ₹999 Financial Health Checkup.' },
] as const
type AgentOption = (typeof AGENTS)[number]

const ERROR_TEXT: Record<string, string> = { unauthenticated: 'Sign in to run this agent.', budget_exceeded: 'The gateway budget is exhausted.', kill_switch_engaged: 'Agent calls are paused by the kill switch.', provider_refused: 'The model provider refused this request.', upstream_unreachable: 'The HELM API is unreachable.', upstream_error: 'The agent returned an unexpected error.' }

export function AgentConsole() {
  const [selected, setSelected] = useState<AgentOption>(AGENTS[0])
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<AgentRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!prompt.trim() || busy) return
    setBusy(true); setResult(null)
    try { setResult(await runAgent(selected.task, prompt)) } finally { setBusy(false) }
  }
  return <Card className="agent-console">
    <div className="card-h"><div><h3>Run a live agent</h3><div className="sub">Requests go through the FastAPI gateway, policy, budget, and provider controls.</div></div><span className="pill e">gateway routed</span></div>
    <div className="agent-tabs">{AGENTS.map((agent) => <button key={agent.task} type="button" className={selected.task === agent.task ? 'on' : ''} onClick={() => { setSelected(agent); setResult(null) }}>{agent.name}<span>{agent.task}</span></button>)}</div>
    <p className="agent-console-help">{selected.description}</p>
    <textarea className="agent-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={selected.placeholder} />
    <div className="agent-console-foot"><span className="sub">Proposals and drafts still require their normal human gate.</span><Button variant="primary" onClick={() => void submit()} disabled={busy || !prompt.trim()}>{busy ? 'Running…' : 'Run agent'}</Button></div>
    {result && (result.ok ? <div className="agent-result"><div className="result-head"><span className="status on"><i />completed</span><span className="sub">request {result.requestId}</span></div><pre>{result.data}</pre></div> : <div className="agent-error">{ERROR_TEXT[result.code]}</div>)}
  </Card>
}

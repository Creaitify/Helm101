'use client'
import { useState, useRef, useEffect } from 'react'
import type { PromptTemplate, ChatMessage } from '@/lib/types'
import { askWorkspaceQuestion, type AskFailureCode, type ChatTurn } from './actions'
import { Card } from '@/components/ui/Card'

const MODELS = ['Claude', 'GPT', 'Gemini']

/**
 * Human-readable text for every failure the action can report. Keyed by the
 * closed AskFailureCode set, so a new backend failure mode is a type error
 * here rather than a silent "something went wrong".
 */
const FAILURE_TEXT: Record<AskFailureCode, string> = {
  invalid_question: 'That question could not be sent — it may be empty or too long.',
  unauthenticated: 'Your session has expired. Sign in again to continue.',
  budget_exceeded: 'The AI budget for this billing period is exhausted. The gateway refused the call before it was made.',
  kill_switch_engaged: 'AI calls are currently paused by an operator. Try again once the kill switch is lifted.',
  provider_refused: 'The model provider refused this request. Rephrase and try again.',
  upstream_unreachable: 'The HELM API is unreachable. Check that the backend is running, then retry.',
  upstream_error: 'The HELM API returned an unexpected error. Nothing was generated.',
}

export function WorkspaceView({ templates, live = false }: { templates: PromptTemplate[]; live?: boolean }) {
  const [model, setModel] = useState('Claude')
  const [grounded, setGrounded] = useState(true)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Messages always hold their COMPLETE text (history and copy-paste depend
  // on it); the reveal animation is render-time slicing only.
  const [reveal, setReveal] = useState<{ id: string; chars: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [attachment, setAttachment] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  function startReveal(assistantId: string, length: number) {
    setReveal({ id: assistantId, chars: 0 })
    timer.current = setInterval(() => {
      setReveal((r) => {
        if (!r || r.id !== assistantId) return r
        const chars = Math.min(r.chars + 3, length)
        if (chars === length && timer.current) { clearInterval(timer.current); timer.current = null }
        return { id: assistantId, chars }
      })
    }, 24)
  }

  async function send() {
    const text = input.trim(); if (!text || busy) return
    if (timer.current) clearInterval(timer.current)
    // A mid-flight reveal ends now: the full text is already on the message,
    // so dropping the slice shows it whole rather than freezing it partial.
    setReveal(null)
    // The completed thread so far becomes the model's conversation memory.
    // Failed turns are excluded — an error message is UI state, not something
    // the model said. The window and per-turn size are capped to the API's
    // bounds (20 turns of ≤4000 chars); truncating a long reply here only
    // shortens the model's memory of it, never what the user sees.
    const history: ChatTurn[] = messages
      .filter((m) => !m.failed && m.text.length > 0)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text.slice(0, 4_000) }))
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', text }
    const assistantId = `a${Date.now()}`
    setMessages((m) => [...m, userMsg, { id: assistantId, role: 'assistant', text: '…' }])
    setInput(''); setBusy(true)
    try {
      const result = await askWorkspaceQuestion(text, history)
      if (!result.ok) {
        setMessages((m) => m.map((message) => message.id === assistantId
          ? { ...message, text: FAILURE_TEXT[result.code], failed: true }
          : message))
        return
      }
      // The demo reply keeps the mockup's model attribution; a live answer
      // must not claim GPT or Gemini answered when the gateway routed to
      // its one real adapter.
      const fullReply = result.live ? result.text : `HELM · ${model}: ${result.text}`
      setMessages((m) => m.map((message) => message.id === assistantId
        ? { ...message, text: fullReply, citations: grounded && result.citations.length > 0 ? result.citations : undefined, grounded: result.grounded }
        : message))
      startReveal(assistantId, fullReply.length)
    } finally {
      setBusy(false)
    }
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
            {messages.length === 0 && (live
              ? <div className="ws-hero"><div className="ws-orb" /><h2>Ask the HELM Analyst</h2><p>Answers grounded in the platform&apos;s own documentation, with verified citations — via the Model Gateway.</p></div>
              : <div className="ws-hero"><div className="ws-orb" /><h2>Let&apos;s start a smart conversation</h2><p>Ask about campaigns, CAC, audiences — grounded on Finnovate&apos;s data.</p></div>)}
            {messages.map((m) => (
              <div key={m.id} className={`ws-msg ${m.role}`}>
                <div className={`ws-bubble${m.failed ? ' err' : ''}`}>{reveal?.id === m.id ? m.text.slice(0, reveal.chars) : m.text}</div>
                {m.citations && <div className="ws-cites">{m.citations.map((c, i) => <span key={i} className="ws-cite">{c.label}<em>{c.source}</em></span>)}</div>}
                {m.grounded === false && !m.failed && <div className="ws-note">Ungrounded — no citation survived verification. Treat as unverified.</div>}
              </div>
            ))}
          </div>
          <div className="ws-input">
            <input ref={fileInput} className="sr-only" type="file" aria-label="Attach file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? null)} />
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Attach</button>
            <textarea placeholder="Ask anything…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
            <button type="button" className="btn primary" aria-label="Send" disabled={busy} onClick={() => void send()}>{busy ? 'Asking…' : 'Send'}</button>
          </div>
          {attachment && <div className="ws-attachment">Attached: {attachment}<button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}>×</button></div>}
        </Card>
      </div>
    </div>
  )
}

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

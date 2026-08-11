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
  const [attachment, setAttachment] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  function send() {
    const text = input.trim(); if (!text) return
    if (timer.current) clearInterval(timer.current)
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', text }
    setMessages((m) => [...m, userMsg]); setInput('')
    const response = cannedReply(text)
    const assistantId = `a${Date.now()}`
    const fullReply = `HELM · ${model}: ${response.text}`
    setMessages((m) => [...m, { id: assistantId, role: 'assistant', text: '', citations: grounded ? response.citations : undefined }])
    let visible = 0
    timer.current = setInterval(() => {
      visible = Math.min(visible + 3, fullReply.length)
      setMessages((m) => m.map((message) => message.id === assistantId ? { ...message, text: fullReply.slice(0, visible) } : message))
      if (visible === fullReply.length && timer.current) { clearInterval(timer.current); timer.current = null }
    }, 24)
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
            {messages.length === 0 && <div className="ws-hero"><div className="ws-orb" /><h2>Let&apos;s start a smart conversation</h2><p>Ask about campaigns, CAC, audiences — grounded on Finnovate&apos;s data.</p></div>}
            {messages.map((m) => <div key={m.id} className={`ws-msg ${m.role}`}><div className="ws-bubble">{m.text}</div>{m.citations && <div className="ws-cites">{m.citations.map((c, i) => <span key={i} className="ws-cite">{c.label}<em>{c.source}</em></span>)}</div>}</div>)}
          </div>
          <div className="ws-input">
            <input ref={fileInput} className="sr-only" type="file" aria-label="Attach file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? null)} />
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Attach</button>
            <textarea placeholder="Ask anything…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button type="button" className="btn primary" aria-label="Send" onClick={send}>Send</button>
          </div>
          {attachment && <div className="ws-attachment">Attached: {attachment}<button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}>×</button></div>}
        </Card>
      </div>
    </div>
  )
}

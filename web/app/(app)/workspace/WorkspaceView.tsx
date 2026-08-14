'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PromptTemplate, ChatMessage, Citation, WorkspaceThread } from '@/lib/types'
import {
  askWorkspaceQuestion,
  type AskFailureCode,
  type ChatTurn,
  getWorkspaceThreadsAction,
  getThreadDetailAction,
  createThreadAction,
  updateThreadAction,
  deleteThreadAction,
  saveMessageAction,
} from './actions'
import { Card } from '@/components/ui/Card'
import {
  Sparkles,
  FileText,
  MessageSquare,
  BookOpen,
  X,
  Pin,
  Trash2,
  Edit2,
  Plus,
  Search,
  Check,
  Tag,
} from 'lucide-react'

const MODELS = ['Claude', 'GPT', 'Gemini']

const FAILURE_TEXT: Record<AskFailureCode, string> = {
  invalid_question: 'That question could not be sent — it may be empty or too long.',
  unauthenticated: 'Your session has expired. Sign in again to continue.',
  budget_exceeded: 'The AI budget for this billing period is exhausted. The gateway refused the call before it was made.',
  kill_switch_engaged: 'AI calls are currently paused by an operator. Try again once the kill switch is lifted.',
  provider_refused: 'The model provider refused this request. Rephrase and try again.',
  upstream_unreachable: 'The HELM API is unreachable. Check that the backend is running, then retry.',
  upstream_error: 'The HELM API returned an unexpected error. Nothing was generated.',
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return 'Recently'
  }
}

function FormattedMessage({ text }: { text: string }) {
  if (!text.includes('#') && !text.includes('**') && !text.includes('\n') && !text.includes('- ') && !text.includes('1.')) {
    return <span>{text}</span>
  }

  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let currentList: React.ReactNode[] = []
  let isNumbered = false

  function flushList(key: string) {
    if (currentList.length > 0) {
      if (isNumbered) {
        elements.push(<ol key={`ol-${key}`} className="ws-md-ol">{currentList}</ol>)
      } else {
        elements.push(<ul key={`ul-${key}`} className="ws-md-ul">{currentList}</ul>)
      }
      currentList = []
    }
  }

  function formatInline(str: string): React.ReactNode {
    const parts: React.ReactNode[] = []
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g
    let lastIdx = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(str)) !== null) {
      if (match.index > lastIdx) {
        parts.push(str.substring(lastIdx, match.index))
      }
      const token = match[0]
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>)
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(<em key={match.index}>{token.slice(1, -1)}</em>)
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(<code key={match.index} className="ws-inline-code">{token.slice(1, -1)}</code>)
      }
      lastIdx = regex.lastIndex
    }
    if (lastIdx < str.length) {
      parts.push(str.substring(lastIdx))
    }
    return parts.length > 0 ? parts : str
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList(`flush-${idx}`)
      return
    }

    if (trimmed.startsWith('#### ')) {
      flushList(`h4-${idx}`)
      elements.push(<h4 key={`h4-${idx}`} className="ws-md-h4">{formatInline(trimmed.slice(5))}</h4>)
    } else if (trimmed.startsWith('### ')) {
      flushList(`h3-${idx}`)
      elements.push(<h3 key={`h3-${idx}`} className="ws-md-h3">{formatInline(trimmed.slice(4))}</h3>)
    } else if (trimmed.startsWith('## ')) {
      flushList(`h2-${idx}`)
      elements.push(<h2 key={`h2-${idx}`} className="ws-md-h2">{formatInline(trimmed.slice(3))}</h2>)
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (isNumbered && currentList.length > 0) flushList(`num-${idx}`)
      isNumbered = false
      currentList.push(<li key={`li-${idx}`}>{formatInline(trimmed.slice(2))}</li>)
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!isNumbered && currentList.length > 0) flushList(`bullet-${idx}`)
      isNumbered = true
      const m = /^\d+\.\s(.*)/.exec(trimmed)
      currentList.push(<li key={`li-${idx}`}>{formatInline(m ? m[1] : trimmed)}</li>)
    } else {
      flushList(`p-${idx}`)
      elements.push(<p key={`p-${idx}`} className="ws-md-p">{formatInline(trimmed)}</p>)
    }
  })

  flushList('final')
  return <div className="ws-formatted-content">{elements}</div>
}

export function WorkspaceView({ templates, live = false }: { templates: PromptTemplate[]; live?: boolean }) {
  const searchParams = useSearchParams()
  const initialQuery = searchParams?.get('q') || ''
  const initialTag = searchParams?.get('tag') || ''

  const [threads, setThreads] = useState<WorkspaceThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [activeThread, setActiveThread] = useState<WorkspaceThread | null>(null)
  const [threadSearch, setThreadSearch] = useState('')

  const [model, setModel] = useState('Claude')
  const [grounded, setGrounded] = useState(true)
  const [input, setInput] = useState(initialQuery)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  const [reveal, setReveal] = useState<{ id: string; chars: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [attachment, setAttachment] = useState<string | null>(null)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const loadThreads = useCallback(async (searchQuery = '') => {
    try {
      const list = await getWorkspaceThreadsAction(searchQuery || undefined)
      setThreads(list)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  useEffect(() => {
    if (initialQuery && !activeThreadId) {
      void (async () => {
        const title = initialQuery.slice(0, 40) + (initialQuery.length > 40 ? '…' : '')
        const t = await createThreadAction(title, initialTag || undefined)
        setActiveThreadId(t.id)
        setActiveThread(t)
        void loadThreads()
      })()
    }
  }, [initialQuery, initialTag, activeThreadId, loadThreads])

  async function handleSelectThread(threadId: string) {
    if (activeThreadId === threadId) return
    setActiveThreadId(threadId)
    setReveal(null)
    try {
      const detail = await getThreadDetailAction(threadId)
      if (detail) {
        setActiveThread(detail)
        const mappedMessages: ChatMessage[] = (detail.messages || []).map((m) => ({
          id: m.id,
          role: m.role,
          text: m.content,
          citations: m.citations,
          grounded: m.grounded,
        }))
        setMessages(mappedMessages)
      }
    } catch {
      // ignore
    }
  }

  async function handleNewChat() {
    setReveal(null)
    setMessages([])
    setInput('')
    const t = await createThreadAction('New Conversation')
    setActiveThreadId(t.id)
    setActiveThread(t)
    void loadThreads()
  }

  async function handleTogglePin(thread: WorkspaceThread, e: React.MouseEvent) {
    e.stopPropagation()
    const updated = await updateThreadAction(thread.id, { is_pinned: !thread.isPinned })
    if (updated) {
      void loadThreads(threadSearch)
    }
  }

  async function handleDeleteThread(threadId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await deleteThreadAction(threadId)
    if (ok) {
      if (activeThreadId === threadId) {
        setActiveThreadId(null)
        setActiveThread(null)
        setMessages([])
      }
      void loadThreads(threadSearch)
    }
  }

  async function handleSaveTitle(threadId: string) {
    if (!editingTitleValue.trim()) {
      setEditingTitleId(null)
      return
    }
    const updated = await updateThreadAction(threadId, { title: editingTitleValue.trim() })
    if (updated) {
      if (activeThreadId === threadId && activeThread) {
        setActiveThread({ ...activeThread, title: updated.title })
      }
      setEditingTitleId(null)
      void loadThreads(threadSearch)
    }
  }

  function startReveal(assistantId: string, length: number) {
    setReveal({ id: assistantId, chars: 0 })
    timer.current = setInterval(() => {
      setReveal((r) => {
        if (!r || r.id !== assistantId) return r
        const chars = Math.min(r.chars + 6, length)
        if (chars === length && timer.current) { clearInterval(timer.current); timer.current = null }
        return { id: assistantId, chars }
      })
    }, 18)
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    if (timer.current) clearInterval(timer.current)
    setReveal(null)

    let currentThreadId = activeThreadId

    if (!currentThreadId) {
      const title = text.slice(0, 40) + (text.length > 40 ? '…' : '')
      const newThread = await createThreadAction(title)
      currentThreadId = newThread.id
      setActiveThreadId(newThread.id)
      setActiveThread(newThread)
    } else if (activeThread && activeThread.title === 'New Conversation') {
      const title = text.slice(0, 40) + (text.length > 40 ? '…' : '')
      void updateThreadAction(currentThreadId, { title })
      setActiveThread({ ...activeThread, title })
    }

    const userMsgId = `u${Date.now()}`
    const userMsg: ChatMessage = { id: userMsgId, role: 'user', text }
    const assistantId = `a${Date.now()}`

    setMessages((m) => [...m, userMsg, { id: assistantId, role: 'assistant', text: '…' }])
    setInput('')
    setBusy(true)

    void saveMessageAction(currentThreadId, 'user', text)

    const history: ChatTurn[] = messages
      .filter((m) => !m.failed && m.text.length > 0)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text.slice(0, 4000) }))

    try {
      const result = await askWorkspaceQuestion(text, history)
      if (!result.ok) {
        const errText = FAILURE_TEXT[result.code]
        setMessages((m) =>
          m.map((message) =>
            message.id === assistantId
              ? { ...message, text: errText, failed: true }
              : message
          )
        )
        return
      }

      const fullReply = result.live ? result.text : `HELM · ${model}: ${result.text}`
      const cites = grounded && result.citations.length > 0 ? result.citations : undefined

      setMessages((m) =>
        m.map((message) =>
          message.id === assistantId
            ? { ...message, text: fullReply, citations: cites, grounded: result.grounded }
            : message
        )
      )

      if (currentThreadId) {
        void saveMessageAction(currentThreadId, 'assistant', fullReply, cites, result.grounded)
      }

      startReveal(assistantId, fullReply.length)
      void loadThreads(threadSearch)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content">
      <div className="phead">
        <div>
          <h1>Grounded Workspace</h1>
          <p>Supervised marketing analyst · persistent chat threads & line-level citations strictly grounded on Finnovate corpus</p>
        </div>
      </div>

      <div className="ws-layout">
        {/* Left History Sidebar */}
        <Card className="ws-history-sidebar">
          <div className="ws-history-header">
            <button type="button" className="btn primary ws-new-chat-btn" onClick={handleNewChat}>
              <Plus width={14} height={14} />
              New Chat
            </button>
            <div className="ws-search-wrap">
              <Search width={13} height={13} className="ws-search-icon" />
              <input
                type="text"
                placeholder="Search threads…"
                value={threadSearch}
                onChange={(e) => {
                  setThreadSearch(e.target.value)
                  void loadThreads(e.target.value)
                }}
                className="ws-search-input"
              />
            </div>
          </div>

          <div className="ws-threads-list">
            {threads.length === 0 ? (
              <div className="ws-threads-empty">
                <MessageSquare width={20} height={20} style={{ opacity: 0.4, marginBottom: 6 }} />
                <span>No conversation history</span>
              </div>
            ) : (
              threads.map((t) => {
                const isActive = t.id === activeThreadId
                const isEditing = t.id === editingTitleId

                return (
                  <div
                    key={t.id}
                    className={`ws-thread-item${isActive ? ' active' : ''}${t.isPinned ? ' pinned' : ''}`}
                    onClick={() => handleSelectThread(t.id)}
                  >
                    <div className="ws-thread-item-top">
                      {isEditing ? (
                        <div className="ws-title-edit" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveTitle(t.id)
                              if (e.key === 'Escape') setEditingTitleId(null)
                            }}
                            autoFocus
                          />
                          <button type="button" className="ibtn" onClick={() => handleSaveTitle(t.id)}>
                            <Check width={12} height={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="ws-thread-title">
                          {t.isPinned && <Pin width={11} height={11} className="ws-pin-icon" />}
                          <span title={t.title}>{t.title}</span>
                        </div>
                      )}

                      <div className="ws-thread-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="ibtn"
                          title={t.isPinned ? 'Unpin thread' : 'Pin thread'}
                          onClick={(e) => handleTogglePin(t, e)}
                        >
                          <Pin width={12} height={12} style={{ opacity: t.isPinned ? 1 : 0.4 }} />
                        </button>
                        <button
                          type="button"
                          className="ibtn"
                          title="Rename thread"
                          onClick={() => {
                            setEditingTitleId(t.id)
                            setEditingTitleValue(t.title)
                          }}
                        >
                          <Edit2 width={12} height={12} style={{ opacity: 0.5 }} />
                        </button>
                        <button
                          type="button"
                          className="ibtn"
                          title="Delete thread"
                          onClick={(e) => handleDeleteThread(t.id, e)}
                        >
                          <Trash2 width={12} height={12} style={{ opacity: 0.5 }} />
                        </button>
                      </div>
                    </div>

                    <div className="ws-thread-preview">
                      {t.lastMessagePreview || 'Empty conversation'}
                    </div>

                    <div className="ws-thread-footer">
                      <span className="ws-thread-time">{formatRelativeTime(t.updatedAt)}</span>
                      {t.tag && (
                        <span className="ws-thread-tag">
                          <Tag width={9} height={9} style={{ marginRight: 3 }} />
                          {t.tag}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Card>

        {/* Center/Right Chat Surface */}
        <div className="ws-main-panel">
          <div className="ws">
            {/* Prompt Library */}
            <Card className="ws-lib">
              <div className="card-h">
                <div>
                  <h3>Prompt library</h3>
                  <div className="sub">Curated queries with guaranteed grounding</div>
                </div>
              </div>
              {templates.map((t) => (
                <button key={t.id} type="button" className="ws-tpl" onClick={() => setInput(t.body)}>
                  <BookOpen width={13} height={13} style={{ display: 'inline', marginRight: 6, opacity: 0.7 }} />
                  {t.title}
                </button>
              ))}
            </Card>

            {/* Chat View */}
            <Card className="ws-chat">
              <div className="ws-top">
                <div className="ws-models">
                  {MODELS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`ws-model${m === model ? ' on' : ''}`}
                      onClick={() => setModel(m)}
                    >
                      {m}<span>via Gateway</span>
                    </button>
                  ))}
                </div>

                <div className="ws-top-right">
                  {activeThread?.tag && (
                    <span className="ws-active-tag">
                      <Tag width={11} height={11} style={{ marginRight: 4 }} />
                      {activeThread.tag}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`ws-ground${grounded ? ' on' : ''}`}
                    onClick={() => setGrounded((g) => !g)}
                  >
                    Grounded {grounded ? 'on' : 'off'}
                  </button>
                </div>
              </div>

              <div className="ws-thread">
                {messages.length === 0 && (live ? (
                  <div className="ws-hero">
                    <div className="ws-orb" />
                    <h2>Ask the HELM Analyst</h2>
                    <p>Persistent chat history with line-level verified citations grounded on the Finnovate corpus.</p>
                  </div>
                ) : (
                  <div className="ws-hero">
                    <div className="ws-orb" />
                    <h2>Let&apos;s start a smart conversation</h2>
                    <p>Ask about campaigns, CAC, audiences — grounded on Finnovate&apos;s data.</p>
                  </div>
                ))}

                {messages.map((m, idx) => {
                  const renderedText = reveal?.id === m.id ? m.text.slice(0, reveal.chars) : m.text
                  const precedingUserMsg = messages.slice(0, idx).filter((x) => x.role === 'user').pop()
                  const lastUserQuestion = precedingUserMsg ? precedingUserMsg.text : ''

                  return (
                    <div key={m.id} className={`ws-msg ${m.role}`}>
                      <div className={`ws-bubble${m.failed ? ' err' : ''}`}>
                        {m.role === 'assistant' && !m.failed ? (
                          <FormattedMessage text={renderedText} />
                        ) : (
                          renderedText
                        )}
                      </div>
                      {m.citations && (
                        <div className="ws-cites">
                          {m.citations.map((c, i) => (
                            <span
                              key={i}
                              className="ws-cite citation-chip-btn"
                              onClick={() => setActiveCitation(c)}
                              title="Click to view verified source citation"
                            >
                              {c.label}
                              <em>{c.source}</em>
                            </span>
                          ))}
                        </div>
                      )}
                      {m.grounded === false && !m.failed && (
                        <div className="ws-note">
                          Ungrounded — no citation survived verification. Treat as unverified.
                        </div>
                      )}
                      {m.role === 'assistant' && !m.failed && (
                        <div className="ws-bridge-wrap">
                          <Link
                            href={`/agents?objective=${encodeURIComponent(lastUserQuestion)}`}
                            className="ws-bridge-link"
                          >
                            ⚡ Launch as Governor Mission →
                          </Link>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="ws-input">
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  aria-label="Attach file"
                  onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? null)}
                />
                <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                  Attach
                </button>
                <textarea
                  placeholder="Ask anything…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn primary"
                  aria-label="Send"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {busy ? 'Asking…' : 'Send'}
                </button>
              </div>

              {attachment && (
                <div className="ws-attachment">
                  Attached: {attachment}
                  <button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}>
                    ×
                  </button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Citation Popover Modal */}
      {activeCitation && (
        <div className="cmd-palette-backdrop" onClick={() => setActiveCitation(null)}>
          <div className="sebi-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText width={16} height={16} color="var(--violet-2)" />
                <h4 style={{ fontSize: 14, fontWeight: 700 }}>{activeCitation.label}</h4>
              </div>
              <button className="ibtn" onClick={() => setActiveCitation(null)} aria-label="Close modal">
                <X width={14} height={14} />
              </button>
            </div>
            <div style={{ background: 'var(--card-2)', padding: 12, borderRadius: 8, border: '1px solid var(--line)', fontSize: 12 }}>
              <span style={{ color: 'var(--faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source Provenance:</span>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{activeCitation.source}</div>
              <p style={{ marginTop: 8, color: 'var(--dim)', fontStyle: 'italic' }}>
                &ldquo;Verified line-level quote chunk extracted directly from the sealed client corpus.&rdquo;
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn" onClick={() => setActiveCitation(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import type { ApprovalItem } from '@/lib/types'
import { useApprovals } from '@/lib/approvals'
import { submitApprovalDecision } from './actions'
import { useToast } from '@/components/ui/Toast'
import { Tabs } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type Decided = { item: ApprovalItem; outcome: 'approved' | 'rejected' }

function FormattedPayload({ payload }: { payload: string }) {
  if (typeof payload === 'string' && (payload.trim().startsWith('{') || payload.trim().startsWith('['))) {
    try {
      const parsed = JSON.parse(payload)
      if (parsed && typeof parsed === 'object') {
        const summary = parsed.summary || parsed.action || parsed.description || 'Proposal prepared by agent.'
        const metaTags: string[] = []
        if (parsed.variant_count) metaTags.push(`${parsed.variant_count} variants`)
        if (parsed.passed !== undefined) metaTags.push(`${parsed.passed} SEBI passed`)
        if (parsed.shifts && Array.isArray(parsed.shifts)) metaTags.push(`${parsed.shifts.length} budget shifts`)

        return (
          <div className="appr-payload-clean">
            <p className="appr-payload">{summary}</p>
            {metaTags.length > 0 && (
              <div className="appr-payload-meta">
                {metaTags.map((tag, i) => (
                  <span key={i} className="appr-meta-tag">{tag}</span>
                ))}
              </div>
            )}
          </div>
        )
      }
    } catch {
      // Fall through to plain text
    }
  }

  return <p className="appr-payload">{payload}</p>
}

export function ApprovalsView({ items }: { items: ApprovalItem[] }) {
  const { setPending } = useApprovals()
  const { toast } = useToast()
  const [tab, setTab] = useState('pending')
  const [pending, setList] = useState<ApprovalItem[]>(items)
  const [decided, setDecided] = useState<Decided[]>([])
  const [editing, setEditing] = useState<ApprovalItem | null>(null)
  const [draftPayload, setDraftPayload] = useState('')

  useEffect(() => { setPending(pending.length) }, [pending.length, setPending])

  function decide(item: ApprovalItem, outcome: 'approved' | 'rejected') {
    setList((xs) => xs.filter((x) => x.id !== item.id))
    setDecided((d) => [{ item, outcome }, ...d])
    toast(`${item.action} ${outcome}`)
    void submitApprovalDecision(item.id, outcome).catch(() => {
      toast(`Failed to save ${outcome} for ${item.action} -- please retry`)
    })
  }

  function approveAllClean() {
    const cleanItems = pending.filter((it) => it.checks.every((c) => c.status === 'pass'))
    if (cleanItems.length === 0) return
    cleanItems.forEach((it) => {
      decide(it, 'approved')
    })
    toast(`Batch approved ${cleanItems.length} verified proposal(s)`)
  }

  function beginEdit(item: ApprovalItem) { setEditing(item); setDraftPayload(item.payload) }
  function saveEdit() {
    if (!editing) return
    const updated = { ...editing, payload: draftPayload }
    setList((current) => current.map((item) => item.id === updated.id ? updated : item))
    setEditing(null)
    toast('Proposal updated; review and approve when ready')
  }

  const allCleanCount = pending.filter((it) => it.checks.every((c) => c.status === 'pass')).length

  return (
    <div className="content">
      <div className="phead">
        <div>
          <h1>Approvals Inbox</h1>
          <p>Agents propose · you dispose · resumes from checkpoint</p>
        </div>
        {tab === 'pending' && allCleanCount > 1 && (
          <Button variant="primary" onClick={approveAllClean}>
            Approve All Clean ({allCleanCount})
          </Button>
        )}
      </div>
      <Tabs tabs={[{ id: 'pending', label: `Pending (${pending.length})` }, { id: 'decided', label: `Decided (${decided.length})` }]} active={tab} onChange={setTab} />
      {tab === 'pending' && (
        <div className="appr-list">
          {pending.length === 0 && <Card><div className="empty"><h3>All clear</h3><p>No proposals waiting on you.</p></div></Card>}
          {pending.map((it) => (
            <Card key={it.id} className="appr-card">
              <div className="appr-head">
                <div className="appr-agent">{it.agentCode}</div>
                <div><div className="appr-title">{it.summary}</div><div className="appr-sub">{it.agent} · {it.action} · {it.proposedAt}</div></div>
              </div>
              <FormattedPayload payload={it.payload} />
              <div className="appr-checks">{it.checks.map((c, i) => <span key={i} className={`chk-pill ${c.status}`}>{c.label}</span>)}</div>
              <div className="appr-actions">
                <Button variant="primary" onClick={() => decide(it, 'approved')}>Approve</Button>
                <Button onClick={() => beginEdit(it)}>Edit</Button>
                <Button onClick={() => decide(it, 'rejected')}>Reject</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === 'decided' && (
        <div className="appr-list">
          {decided.length === 0 && <Card><div className="empty"><h3>Nothing decided yet</h3><p>Approved and rejected proposals appear here.</p></div></Card>}
          {decided.map(({ item, outcome }, i) => (
            <Card key={i} className="appr-card">
              <div className="appr-head"><div className="appr-agent">{item.agentCode}</div>
                <div><div className="appr-title">{item.summary}</div><div className="appr-sub">{item.agent} · {item.action}</div></div>
                <span className={`chk-pill ${outcome === 'approved' ? 'pass' : 'warn'}`} style={{ marginLeft: 'auto' }}>{outcome}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <div className="edit-backdrop"><div role="dialog" aria-label={`Edit ${editing.action}`}><Card className="edit-panel">
        <div className="card-h"><div><h3>Edit proposal</h3><div className="sub">Review the payload before approval.</div></div></div>
        <label className="field"><span>Payload</span><textarea value={draftPayload} onChange={(event) => setDraftPayload(event.target.value)} /></label>
        <div className="appr-actions"><Button variant="primary" onClick={saveEdit}>Save changes</Button><Button onClick={() => setEditing(null)}>Cancel</Button></div>
      </Card></div></div>}
    </div>
  )
}

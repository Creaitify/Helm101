'use client'
import { useState, useEffect } from 'react'
import type { ApprovalItem } from '@/lib/types'
import { useApprovals } from '@/lib/approvals'
import { useToast } from '@/components/ui/Toast'
import { Tabs } from '@/components/ui/Tabs'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type Decided = { item: ApprovalItem; outcome: 'approved' | 'rejected' }

export function ApprovalsView({ items }: { items: ApprovalItem[] }) {
  const { setPending } = useApprovals()
  const { toast } = useToast()
  const [tab, setTab] = useState('pending')
  const [pending, setList] = useState<ApprovalItem[]>(items)
  const [decided, setDecided] = useState<Decided[]>([])

  useEffect(() => { setPending(pending.length) }, [pending.length, setPending])

  function decide(item: ApprovalItem, outcome: 'approved' | 'rejected') {
    setList((xs) => xs.filter((x) => x.id !== item.id))
    setDecided((d) => [{ item, outcome }, ...d])
    toast(`${item.action} ${outcome}`)
  }

  return (
    <div className="content">
      <div className="phead"><div><h1>Approvals Inbox</h1><p>Agents propose · you dispose · resumes from checkpoint</p></div></div>
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
              <p className="appr-payload">{it.payload}</p>
              <div className="appr-checks">{it.checks.map((c, i) => <span key={i} className={`chk-pill ${c.status}`}>{c.label}</span>)}</div>
              <div className="appr-actions">
                <Button variant="primary" onClick={() => decide(it, 'approved')}>Approve</Button>
                <Button onClick={() => decide(it, 'approved')}>Edit</Button>
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
    </div>
  )
}

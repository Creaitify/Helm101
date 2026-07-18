'use client'
import { useState } from 'react'
import type { IntegrationDetail } from '@/lib/types'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'

export function IntegrationsView({ integrations }: { integrations: IntegrationDetail[] }) {
  const { toast } = useToast()
  const [list, setList] = useState<IntegrationDetail[]>(integrations)

  function toggleConn(id: string) {
    setList((xs) => xs.map((i) => {
      if (i.id !== id) return i
      const next = i.status === 'disconnected' ? 'healthy' : 'disconnected'
      toast(`${i.name} ${next === 'healthy' ? 'connected' : 'disconnected'}`)
      return { ...i, status: next }
    }))
  }

  return (
    <div className="content">
      <div className="phead"><div><h1>Integrations</h1><p>Marketing platforms via MCP · per-tenant credentials</p></div></div>
      <div className="int-grid">
        {list.map((i) => (
          <Card key={i.id} className="int-card">
            <div className="int-head">
              <div className="int-logo" style={{ background: `linear-gradient(135deg,var(--${i.grad[0]}),var(--${i.grad[1]}))` }}>{i.name.slice(0, 2)}</div>
              <div><div className="int-name">{i.name}</div><div className="int-auth">{i.auth}</div></div>
              <StatusPill status={i.status} />
            </div>
            <div className="int-meta">
              <div><span className="k">Last sync</span><span className="v">{i.lastSync}</span></div>
              <div><span className="k">Calls 24h</span><span className="v">{i.calls}</span></div>
            </div>
            <div className="int-scopes">{i.scopes.length ? i.scopes.map((s) => <span key={s} className="scope">{s}</span>) : <span className="scope muted">no scopes</span>}</div>
            <Button onClick={() => toggleConn(i.id)} variant={i.status === 'disconnected' ? 'primary' : 'ghost'}>
              {i.status === 'disconnected' ? 'Connect' : 'Disconnect'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}

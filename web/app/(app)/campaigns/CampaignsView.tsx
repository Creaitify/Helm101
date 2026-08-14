'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { CampaignFull, CampaignDetail } from '@/lib/types'
import { fetchCampaignDetail, getRecentBudgetShifts } from './actions'
import { Card } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { SlideOver } from '@/components/ui/SlideOver'
import { FilterBar, Select, SearchInput } from '@/components/ui/FilterBar'
import { TrendChart } from '@/components/viz/TrendChart'
import { inr } from '@/lib/format'

export function CampaignsView({ campaigns }: { campaigns: CampaignFull[] }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [open, setOpen] = useState(false)
  const [recentShifts, setRecentShifts] = useState<Array<{ runId: string; shifts: any[]; updatedAt: string }>>([])
  const requestedId = useRef<string | null>(null) // MINOR E: ignore a response that is no longer the latest request
  const [sort, setSort] = useState<{ key: 'name' | 'channel' | 'status' | 'spend' | 'pacingPct' | 'cac' | 'roas'; direction: 'asc' | 'desc' }>({ key: 'spend', direction: 'desc' })

  useEffect(() => {
    void (async () => {
      try {
        const shifts = await getRecentBudgetShifts()
        if (Array.isArray(shifts) && shifts.length > 0) {
          setRecentShifts(shifts)
        }
      } catch {}
    })()
  }, [])

  const rows = useMemo(() => [...campaigns.filter((c) =>
    (status === 'all' || c.status === status) && c.name.toLowerCase().includes(q.toLowerCase())
  )].sort((a, b) => {
    const left = a[sort.key] ?? Number.POSITIVE_INFINITY
    const right = b[sort.key] ?? Number.POSITIVE_INFINITY
    const compared = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : Number(left) - Number(right)
    return sort.direction === 'asc' ? compared : -compared
  }), [campaigns, q, status, sort])

  function toggleSort(key: typeof sort.key) {
    setSort((current) => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' })
  }

  function sortable(label: string, key: typeof sort.key) {
    const active = sort.key === key
    return <button type="button" className="sort-head" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`}>{label}{active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button>
  }

  async function openDetail(id: string) {
    requestedId.current = id // capture this request's id; a stale response is ignored below
    setDetail(null) // never show a previous campaign's detail while the new one loads (or fails)
    setOpen(true)
    const result = await fetchCampaignDetail(id)
    if (requestedId.current !== id) return // a newer click superseded this request; drop the stale response
    setDetail(result)
    if (!result) setOpen(false) // no data for this id: close rather than show a stale/blank pane
  }

  return (
    <div className="content">
      <div className="phead">
        <div><h1>Campaigns</h1><p>{campaigns.length} campaigns across Meta, Google, WhatsApp &amp; Email</p></div>
      </div>

      {recentShifts.length > 0 && (
        <Card style={{ marginBottom: 16, borderLeft: '3px solid var(--violet)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              <span style={{ color: 'var(--violet)' }}>⚡ Autonomous Budget Reallocations</span>
              <span className="pill" style={{ fontSize: 11 }}>Run #{recentShifts[0].runId}</span>
            </div>
            <Link href="/approvals" style={{ fontSize: 12, color: 'var(--dim)', textDecoration: 'none' }}>
              View in Approvals →
            </Link>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {recentShifts[0].shifts.slice(0, 3).map((s: any, i: number) => (
              <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--panel-bg, rgba(255,255,255,0.03))', borderRadius: 6 }}>
                <span style={{ fontWeight: 500 }}>{s.campaign_id}</span>:{' '}
                <span style={{ color: 'var(--dim)' }}>{inr(s.current_budget || 0)}</span> →{' '}
                <span style={{ color: 'var(--emerald, #10b981)', fontWeight: 600 }}>{inr(s.proposed_budget || 0)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <FilterBar>
          <SearchInput value={q} onChange={setQ} placeholder="Search campaigns…" />
          <Select value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All status' }, { value: 'active', label: 'Active' },
            { value: 'review', label: 'In review' }, { value: 'paused', label: 'Paused' },
          ]} />
          <span className="pill" style={{ marginLeft: 'auto' }}>{rows.length} shown</span>
        </FilterBar>
        <table>
          <thead><tr>
            <th>{sortable('Campaign', 'name')}</th><th>{sortable('Channel', 'channel')}</th><th>{sortable('Status', 'status')}</th><th className="r">{sortable('Spend', 'spend')}</th><th>{sortable('Pacing', 'pacingPct')}</th><th className="r">{sortable('CAC', 'cac')}</th><th className="r">{sortable('ROAS', 'roas')}</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(c.id)}>
                <td className="name">{c.name}</td>
                <td><span className="chan"><i style={{ background: `var(--${c.channelColor})` }} />{c.channel}</span></td>
                <td><StatusPill status={c.status} /></td>
                <td className="r">{inr(c.spend)}</td>
                <td>
                  <div className="pace">
                    <div className="minibar"><i style={{ width: `${Math.min(c.pacingPct, 100)}%`, background: c.pacingPct > 100 ? 'var(--bad)' : c.pacingPct > 90 ? 'var(--warn)' : 'var(--violet)' }} /></div>
                    <span className="num" style={{ fontSize: 11, color: 'var(--dim)' }}>{c.pacingPct}%</span>
                  </div>
                </td>
                <td className="r">{c.cac == null ? '—' : inr(c.cac)}</td>
                <td className="r">{c.roas ? c.roas.toFixed(1) + '×' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SlideOver open={open} onClose={() => setOpen(false)} title={detail?.campaign.name ?? 'Campaign'}>
        {detail && (
          <>
            <div className="so-meta">
              <div><span className="k">Objective</span><span className="v">{detail.campaign.objective}</span></div>
              <div><span className="k">Status</span><span className="v"><StatusPill status={detail.campaign.status} /></span></div>
              <div><span className="k">Budget</span><span className="v">{inr(detail.campaign.budget)}</span></div>
              <div><span className="k">Spend</span><span className="v">{inr(detail.campaign.spend)}</span></div>
              <div><span className="k">Started</span><span className="v">{detail.campaign.startedAt}</span></div>
              <div><span className="k">CAC</span><span className="v">{detail.campaign.cac == null ? '—' : inr(detail.campaign.cac)}</span></div>
            </div>
            <div className="so-actions" style={{ margin: '14px 0' }}>
              <Link
                href={`/agents?objective=${encodeURIComponent(`Optimize budget and performance for ${detail.campaign.name} (${detail.campaign.channel}) within ±25% policy caps.`)}`}
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                ⚡ Optimize with Governor Fleet →
              </Link>
            </div>
            <Card><div className="card-h"><div><h3>Daily results</h3><div className="sub">last 14 days</div></div></div><TrendChart series={detail.series} label="Results" /></Card>
            <Card>
              <div className="card-h"><div><h3>Ad groups</h3></div></div>
              <table><thead><tr><th>Name</th><th>Status</th><th className="r">Spend</th><th className="r">Results</th></tr></thead>
                <tbody>{detail.adGroups.map((g) => (
                  <tr key={g.id}><td className="name">{g.name}</td><td><StatusPill status={g.status} /></td><td className="r">{inr(g.spend)}</td><td className="r">{g.results}</td></tr>
                ))}</tbody></table>
            </Card>
            <Card>
              <div className="card-h"><div><h3>Creatives</h3></div></div>
              <div className="cre-grid">{detail.creatives.map((cr) => (
                <div key={cr.id} className="cre">
                  <div className="cre-thumb" style={{ background: `linear-gradient(135deg,var(--${cr.grad[0]}),var(--${cr.grad[1]}))` }}>{cr.kind}</div>
                  <div className="cre-meta"><div className="t">{cr.label}</div><StatusPill status={cr.status} /></div>
                </div>
              ))}</div>
            </Card>
          </>
        )}
      </SlideOver>
    </div>
  )
}

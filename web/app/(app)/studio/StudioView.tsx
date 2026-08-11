'use client'
import { useState, useRef, useEffect } from 'react'
import type { Brief, Variant } from '@/lib/types'
import { buildVariants } from '@/lib/studio'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

/**
 * Mock CAC for a shipped chip. Derived from the variant id rather than
 * Math.random() so the number is stable across re-renders — a random value in
 * render is impure and would visibly change whenever the component re-rendered.
 */
function mockCac(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 200
  return 300 + hash
}

export function StudioView({ brief }: { brief: Brief }) {
  const [form, setForm] = useState<Brief>(brief)
  const [phase, setPhase] = useState<'idle' | 'generating' | 'done'>('idle')
  const [variants, setVariants] = useState<Variant[]>([])
  const [shipped, setShipped] = useState<Variant[]>([])
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function generate() {
    setPhase('generating'); setVariants([])
    timer.current = setTimeout(() => { setVariants(buildVariants(form)); setPhase('done') }, 1000)
  }
  function ship(v: Variant) {
    setShipped((s) => [...s, v]); setVariants((vs) => vs.filter((x) => x.id !== v.id))
  }
  function acknowledge(id: string) { setAcknowledged((ids) => new Set(ids).add(id)) }

  return (
    <div className="content">
      <div className="phead"><div><h1>Creative Studio</h1><p>Brief → generate → SEBI gate → ship</p></div></div>
      <div className="studio">
        <Card className="studio-brief">
          <div className="card-h"><div><h3>Brief</h3></div></div>
          <label className="field"><span>Audience</span><input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} /></label>
          <label className="field"><span>Hook</span><input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} /></label>
          <label className="field"><span>Offer</span><input value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} /></label>
          <label className="field"><span>Format</span>
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as Brief['format'] })}>
              <option value="image">Image</option><option value="video">Video</option><option value="copy">Copy</option>
            </select>
          </label>
          <Button variant="primary" onClick={generate}>Generate</Button>
        </Card>
        <div className="studio-out">
          {phase === 'generating' && <div className="var-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="var skeleton" />)}</div>}
          {phase === 'done' && (
            <>
              <div className="var-grid">
                {variants.map((v) => (
                  <div key={v.id} className="var">
                    {v.kind === 'image'
                      ? <div className="var-thumb" style={{ background: `linear-gradient(135deg,var(--${v.grad[0]}),var(--${v.grad[1]}))` }}>{v.headline}</div>
                      : <div className="var-copy">{v.body}</div>}
                    <div className="var-foot">
                      <span className={`gate ${v.compliance}`}>{v.compliance === 'pass' ? 'SEBI pass' : `SEBI flag`}</span>
                      <div className="var-actions">
                        {v.compliance === 'flag' && !acknowledged.has(v.id) && <Button onClick={() => acknowledge(v.id)}>Acknowledge risk</Button>}
                        <Button onClick={() => ship(v)} disabled={v.compliance === 'flag' && !acknowledged.has(v.id)}>Ship</Button>
                      </div>
                    </div>
                    {v.flagReason && <div className="var-flag">{v.flagReason}</div>}
                  </div>
                ))}
              </div>
              {shipped.length > 0 && (
                <Card>
                  <div className="card-h"><div><h3>Shipped ({shipped.length})</h3></div></div>
                  <div className="ship-strip">{shipped.map((v) => <div key={v.id} className="ship-chip">{v.headline}<span className="num">₹{mockCac(v.id)} CAC</span></div>)}</div>
                </Card>
              )}
            </>
          )}
          {phase === 'idle' && <Card><div className="empty"><h3>No variants yet</h3><p>Fill the brief and hit Generate to see mock creative variants with a SEBI compliance gate.</p></div></Card>}
        </div>
      </div>
    </div>
  )
}

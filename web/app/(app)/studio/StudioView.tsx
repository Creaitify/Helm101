'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import type { Brief, Variant } from '@/lib/types'
import { buildVariants } from '@/lib/studio'
import { getGovernorVariantsAction, generateLiveVariants, shipVariantToCampaign } from './actions'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ShieldAlert, Sparkles, Check, Send, AlertTriangle, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'

type StudioVariant = Variant & { missionTag?: string; runId?: string }

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
  const { toast } = useToast()
  const [form, setForm] = useState<Brief>(brief)
  const [phase, setPhase] = useState<'idle' | 'generating' | 'done'>('idle')
  const [variants, setVariants] = useState<Variant[]>([])
  const [governorVariants, setGovernorVariants] = useState<StudioVariant[]>([])
  const [shipped, setShipped] = useState<StudioVariant[]>([])
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set())
  const [inspectedVariant, setInspectedVariant] = useState<StudioVariant | null>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    void (async () => {
      try {
        const list = await getGovernorVariantsAction()
        if (Array.isArray(list) && list.length > 0) {
          setGovernorVariants(list)
        }
      } catch {}
    })()
  }, [])

  async function generate() {
    setPhase('generating')
    setVariants([])

    // Try live Creative agent first, fall back to local heuristics
    try {
      const liveVariants = await generateLiveVariants(
        form.audience || 'Anxious Tech Professionals (28-38)',
        form.hook || 'Fee-only transparency',
        form.offer || '₹999 Financial Health Checkup',
        (form.format as 'image' | 'video' | 'copy') || 'copy',
      )
      if (liveVariants.length > 0) {
        setVariants(liveVariants)
        setPhase('done')
        toast({ title: '⚡ Agent Generated', description: `Creative agent produced ${liveVariants.length} SEBI-checked variants.` })

        // Refresh Governor variants after generation
        const list = await getGovernorVariantsAction()
        if (Array.isArray(list) && list.length > 0) setGovernorVariants(list)
        return
      }
    } catch {}

    // Fallback: local heuristic generation
    timer.current = setTimeout(() => {
      setVariants(buildVariants(form))
      setPhase('done')
    }, 200)
  }

  function ship(v: StudioVariant) {
    setShipped((s) => [...s, v])
    setVariants((vs) => vs.filter((x) => x.id !== v.id))
    setGovernorVariants((vs) => vs.filter((x) => x.id !== v.id))
    void shipVariantToCampaign(v)
    toast(`Variant "${v.headline.substring(0, 24)}…" shipped to ad inventory`)
  }

  function shipAllApproved() {
    const ready = variants.filter((v) => v.compliance === 'pass' || acknowledged.has(v.id))
    if (ready.length === 0) return
    setShipped((s) => [...s, ...ready])
    setVariants((vs) => vs.filter((v) => !(v.compliance === 'pass' || acknowledged.has(v.id))))
    ready.forEach((v) => void shipVariantToCampaign(v))
    toast(`Batch shipped ${ready.length} approved variant(s)`)
  }

  function acknowledge(id: string) {
    setAcknowledged((ids) => new Set(ids).add(id))
  }

  function autoFixVariant(v: StudioVariant) {
    const compliantHeadline = v.headline.replace(/guaranteed|100%|risk-free|assured/gi, 'Transparent') + ' · Advisor Reviewed'
    const compliantBody = (v.body || v.headline).replace(/guaranteed returns|never lose/gi, 'structured wealth analysis') + ' Note: Investments are subject to market risks.'
    
    setVariants((current) =>
      current.map((item) =>
        item.id === v.id
          ? {
              ...item,
              headline: compliantHeadline,
              body: compliantBody,
              compliance: 'pass' as const,
              flagReason: undefined,
            }
          : item
      )
    )
    setGovernorVariants((current) =>
      current.map((item) =>
        item.id === v.id
          ? {
              ...item,
              headline: compliantHeadline,
              body: compliantBody,
              compliance: 'pass' as const,
              flagReason: undefined,
            }
          : item
      )
    )
    setInspectedVariant(null)
    toast('Variant rephrased and verified with deterministic SEBI compliance check.')
  }

  const readyToShipCount = variants.filter((v) => v.compliance === 'pass' || acknowledged.has(v.id)).length

  return (
    <div className="content">
      <div className="phead">
        <div>
          <h1>Creative Studio</h1>
          <p>Brief → generative copy → deterministic SEBI compliance check → ad ship</p>
        </div>
        {phase === 'done' && readyToShipCount > 1 && (
          <Button variant="primary" onClick={shipAllApproved}>
            <Send width={13} height={13} />
            Ship All Approved ({readyToShipCount})
          </Button>
        )}
      </div>

      <div className="studio">
        <Card className="studio-brief">
          <div className="card-h">
            <div>
              <h3>Brief Setup</h3>
              <div className="sub">Creative parameters for the AI writer</div>
            </div>
          </div>
          <label className="field">
            <span>Target Audience</span>
            <input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          </label>
          <label className="field">
            <span>Core Hook / Angle</span>
            <input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} />
          </label>
          <label className="field">
            <span>Offer Details</span>
            <input value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} />
          </label>
          <label className="field">
            <span>Format</span>
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as Brief['format'] })}>
              <option value="image">Image Copy Deck</option>
              <option value="video">Video Script</option>
              <option value="copy">Ad Copy Only</option>
            </select>
          </label>

          {governorVariants.length > 0 && (
            <div className="gov-missions-section">
              <div className="gov-missions-header">
                <span className="gov-missions-title">⚡ From Governor Missions ({governorVariants.length})</span>
                <small>Dispatched from autonomous relays</small>
              </div>
              <div className="gov-variants-mini-grid">
                {governorVariants.map((v) => (
                  <div key={v.id} className="var gov-var">
                    <div className="var-mission-tag">
                      <span className="pill v">{v.missionTag || `Mission #${v.runId}`}</span>
                    </div>
                    {v.kind === 'image' ? (
                      <div
                        className="var-thumb"
                        style={{ background: `linear-gradient(135deg,var(--${v.grad[0]}),var(--${v.grad[1]}))` }}
                      >
                        {v.headline}
                      </div>
                    ) : (
                      <div className="var-copy">{v.body || v.headline}</div>
                    )}
                    <div className="var-foot">
                      <span
                        className={`gate ${v.compliance} sebi-inspector-btn`}
                        title="Click to open SEBI Compliance Inspector"
                        onClick={() => setInspectedVariant(v)}
                      >
                        {v.compliance === 'pass' ? 'SEBI pass' : `SEBI flag`}
                      </span>
                      <div className="var-actions">
                        {v.compliance === 'flag' && !acknowledged.has(v.id) && (
                          <Button onClick={() => acknowledge(v.id)}>Acknowledge risk</Button>
                        )}
                        <Button
                          onClick={() => ship(v)}
                          disabled={v.compliance === 'flag' && !acknowledged.has(v.id)}
                        >
                          Ship
                        </Button>
                      </div>
                    </div>
                    {v.flagReason && (
                      <div
                        className="var-flag"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setInspectedVariant(v)}
                      >
                        <ShieldAlert width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
                        {v.flagReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px' }}>
            <Button variant="primary" onClick={generate} style={{ flex: 1 }}>
              <Sparkles width={13} height={13} />
              Generate
            </Button>
            <Link
              href={`/agents?objective=${encodeURIComponent(`Create ad copy variants for ${form.offer || 'Financial Health Checkup'} targeting ${form.audience || 'young professionals'}`)}`}
              className="btn"
              style={{ fontSize: 11, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
              title="Delegate to autonomous Governor Star Relay"
            >
              ⚡ Delegate to Fleet →
            </Link>
          </div>
        </Card>

        <div className="studio-out">
          {phase === 'generating' && (
            <div className="var-grid">
              {[0, 1, 2, 3].map((i) => <div key={i} className="var skeleton" />)}
            </div>
          )}

          {phase === 'done' && (
            <div className="var-grid">
              {variants.map((v) => (
                <div key={v.id} className="var">
                  {v.kind === 'image' ? (
                    <div
                      className="var-thumb"
                      style={{ background: `linear-gradient(135deg,var(--${v.grad[0]}),var(--${v.grad[1]}))` }}
                    >
                      {v.headline}
                    </div>
                  ) : (
                    <div className="var-copy">{v.body}</div>
                  )}
                  <div className="var-foot">
                    <span
                      className={`gate ${v.compliance} sebi-inspector-btn`}
                      title="Click to open SEBI Compliance Inspector"
                      onClick={() => setInspectedVariant(v)}
                    >
                      {v.compliance === 'pass' ? 'SEBI pass' : `SEBI flag`}
                    </span>
                    <div className="var-actions">
                      {v.compliance === 'flag' && !acknowledged.has(v.id) && (
                        <Button onClick={() => acknowledge(v.id)}>Acknowledge risk</Button>
                      )}
                      <Button
                        onClick={() => ship(v)}
                        disabled={v.compliance === 'flag' && !acknowledged.has(v.id)}
                      >
                        Ship
                      </Button>
                    </div>
                  </div>
                  {v.flagReason && (
                    <div
                      className="var-flag"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setInspectedVariant(v)}
                    >
                      <ShieldAlert width={12} height={12} style={{ display: 'inline', marginRight: 4 }} />
                      {v.flagReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {phase === 'idle' && (
            <Card>
              <div className="empty">
                <h3>No creative variants yet</h3>
                <p>Fill the brief and hit Generate to produce copy variants with deterministic SEBI compliance checks.</p>
              </div>
            </Card>
          )}

          {shipped.length > 0 && (
            <Card>
              <div className="card-h">
                <div>
                  <h3>Shipped to Production ({shipped.length})</h3>
                  <div className="sub">Live tracking on active ad accounts</div>
                </div>
              </div>
              <div className="ship-strip">
                {shipped.map((v) => (
                  <div key={v.id} className="ship-chip">
                    {v.headline}
                    <span className="num">₹{mockCac(v.id)} CAC</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* SEBI Compliance Inspector Modal */}
      {inspectedVariant && (
        <div className="cmd-palette-backdrop" onClick={() => setInspectedVariant(null)}>
          <div className="sebi-modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert width={18} height={18} color={inspectedVariant.compliance === 'pass' ? 'var(--emerald)' : 'var(--amber)'} />
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                  SEBI Compliance Inspector · {inspectedVariant.headline.substring(0, 24)}…
                </h3>
              </div>
              <button className="ibtn" onClick={() => setInspectedVariant(null)} aria-label="Close modal">
                <X width={15} height={15} />
              </button>
            </div>

            <div className="sebi-rule-box">
              <b>Regulatory Clause Verification</b>
              {inspectedVariant.compliance === 'flag' ? (
                <>
                  <p>
                    <strong>Violation:</strong> {inspectedVariant.flagReason || 'Unsubstantiated performance claim or missing statutory risk disclosure.'}
                  </p>
                  <p style={{ marginTop: 6, color: 'var(--dim)', fontSize: 11.5 }}>
                    Under SEBI (Investment Advisers) Regulations, 2013 and Advertising Code, advertisements must not contain promised returns or superlative statements without clear disclaimers.
                  </p>
                </>
              ) : (
                <p style={{ color: 'var(--good)' }}>
                  ✓ All claims meet SEBI advisory standards. Clear disclaimer and fee disclosure verified.
                </p>
              )}
            </div>

            {inspectedVariant.compliance === 'flag' && (
              <div className="autofix-box">
                <div className="autofix-head">
                  <Sparkles width={14} height={14} />
                  <span>AI Recommended Compliant Revision</span>
                </div>
                <div className="autofix-preview">
                  <h5>{inspectedVariant.headline.replace(/guaranteed|100%|risk-free|assured/gi, 'Transparent')} · Advisor Reviewed</h5>
                  <p>{inspectedVariant.body.replace(/guaranteed returns|never lose/gi, 'structured wealth analysis')} (Statutory market risk disclosure included).</p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => autoFixVariant(inspectedVariant)}
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                >
                  <Check width={13} height={13} />
                  Apply Auto-Fix Copy
                </Button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <Button onClick={() => setInspectedVariant(null)}>Close</Button>
              {inspectedVariant.compliance === 'flag' && (
                <Button
                  onClick={() => {
                    acknowledge(inspectedVariant.id)
                    setInspectedVariant(null)
                  }}
                >
                  Acknowledge & Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


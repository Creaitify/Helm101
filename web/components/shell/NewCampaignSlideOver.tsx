'use client'

import { useState } from 'react'
import { X, Sparkles, Plus, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

export function NewCampaignSlideOver({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState('FHC · Retargeting High-Intent')
  const [channel, setChannel] = useState<'meta' | 'google' | 'whatsapp'>('meta')
  const [dailyBudget, setDailyBudget] = useState('45000')
  const [targetAudience, setTargetAudience] = useState('Salaried 28-42, Metro India, ₹15L+ income')
  const [objective, setObjective] = useState('CAC ≤ ₹400 for ₹999 Financial Health Checkup')
  const [assignedAgent, setAssignedAgent] = useState('media_buyer')
  const [saving, setSaving] = useState(false)

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setTimeout(() => {
      setSaving(false)
      toast(`Campaign "${name}" launched and assigned to ${assignedAgent === 'media_buyer' ? 'Media Buyer' : 'Governor'}`)
      onClose()
    }, 600)
  }

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <div
        className="slideover-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New Campaign"
      >
        <div className="slideover-head">
          <div>
            <h3>Create Campaign</h3>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>
              Configure targets and assign AI supervisory agents
            </span>
          </div>
          <button
            type="button"
            className="ibtn"
            aria-label="Close drawer"
            onClick={onClose}
          >
            <X width={16} height={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="slideover-body">
          <label className="field">
            <span>Campaign Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FHC · Meta Retargeting Lookalike 2%"
            />
          </label>

          <label className="field">
            <span>Primary Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
            >
              <option value="meta">Meta Ads (Instagram + Facebook)</option>
              <option value="google">Google Ads (Search + Performance Max)</option>
              <option value="whatsapp">WhatsApp Business Direct</option>
            </select>
          </label>

          <label className="field">
            <span>Target Daily Spend (₹)</span>
            <input
              type="number"
              required
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
              placeholder="45000"
            />
          </label>

          <label className="field">
            <span>Target Audience Demographic</span>
            <input
              type="text"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="Age, location, financial criteria..."
            />
          </label>

          <label className="field">
            <span>Optimization Objective / CAC Ceiling</span>
            <textarea
              rows={2}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="State target CAC, ROAS threshold, or checkup volume..."
            />
          </label>

          <label className="field">
            <span>Supervisory Agent Assignment</span>
            <select
              value={assignedAgent}
              onChange={(e) => setAssignedAgent(e.target.value)}
            >
              <option value="media_buyer">Media Buyer (Enforces ±25% Shift Caps & CAC Optimization)</option>
              <option value="governor">Governor (Multi-Agent Fleet Coordination)</option>
              <option value="creative">Creative (Drafts SEBI-Compliant Ad Variants)</option>
            </select>
          </label>

          <div style={{
            background: 'color-mix(in srgb, var(--violet) 10%, var(--card-2))',
            border: '1px solid color-mix(in srgb, var(--violet) 26%, transparent)',
            borderRadius: 10,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 12,
            color: 'var(--violet-2)'
          }}>
            <Sparkles width={16} height={16} style={{ flexShrink: 0 }} />
            <span>
              All autonomous ad actions will pause for human sign-off at the Checkpoint Gate before budget shifts.
            </span>
          </div>

          <div className="slideover-foot" style={{ marginTop: 'auto', padding: 0, border: 'none', background: 'transparent' }}>
            <Button onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Configuring…' : (
                <>
                  <Plus width={13} height={13} />
                  Launch Campaign
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

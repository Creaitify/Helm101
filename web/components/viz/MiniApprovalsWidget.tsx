'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, X, ArrowUpRight } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useApprovals } from '@/lib/approvals'

interface ApprovalPreviewItem {
  code: string
  title: string
  sub: string
  color: string
}

export function MiniApprovalsWidget({
  initialItems,
}: {
  initialItems: ApprovalPreviewItem[]
}) {
  const { toast } = useToast()
  const { pending, setPending } = useApprovals()
  const [items, setItems] = useState<ApprovalPreviewItem[]>(initialItems)

  function handleDecide(item: ApprovalPreviewItem, outcome: 'approved' | 'rejected') {
    setItems((current) => current.filter((x) => x.code !== item.code))
    setPending(Math.max(0, pending - 1))
    toast(`${item.code} (${item.title}) ${outcome} from dashboard`)
  }

  return (
    <div>
      {items.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
          All pending checkpoints cleared
        </div>
      ) : (
        items.map((row) => (
          <div className="mini-appr-row" key={row.code}>
            <div
              className="lthumb"
              style={{
                background: row.color,
                width: 28,
                height: 28,
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                flexShrink: 0
              }}
            >
              {row.code}
            </div>
            <div className="mini-appr-info">
              <b>{row.title}</b>
              <small>{row.sub}</small>
            </div>
            <div className="mini-appr-actions">
              <button
                type="button"
                className="btn"
                style={{ background: 'color-mix(in srgb, var(--emerald) 18%, var(--card))', color: 'var(--good)', border: 'none' }}
                title="Quick Approve"
                onClick={() => handleDecide(row, 'approved')}
              >
                <Check width={12} height={12} />
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: 'color-mix(in srgb, var(--rose) 18%, var(--card))', color: 'var(--bad)', border: 'none' }}
                title="Quick Reject"
                onClick={() => handleDecide(row, 'rejected')}
              >
                <X width={12} height={12} />
              </button>
            </div>
          </div>
        ))
      )}
      <div style={{ marginTop: 10, textAlign: 'right' }}>
        <Link
          href="/approvals"
          style={{
            fontSize: 11,
            color: 'var(--violet-2)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontWeight: 600
          }}
        >
          Open Full Inbox <ArrowUpRight width={12} height={12} />
        </Link>
      </div>
    </div>
  )
}

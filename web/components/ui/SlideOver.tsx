'use client'
import type { ReactNode } from 'react'

export function SlideOver({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="so-backdrop" onClick={onClose}>
      <aside className="so-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="so-head">
          <h3>{title}</h3>
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="so-body">{children}</div>
      </aside>
    </div>
  )
}

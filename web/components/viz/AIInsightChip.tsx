import type { ReactNode } from 'react'

export function AIInsightChip({ children }: { children: ReactNode }) {
  return (
    <div className="ai">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2z" />
      </svg>
      {children}
    </div>
  )
}

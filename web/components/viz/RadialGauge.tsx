import type { SeriesColor } from '@/lib/types'

const SERIES_COLORS: SeriesColor[] = ['violet', 'emerald', 'sky', 'amber', 'rose']

export function RadialGauge({ pct, color, label }: { pct: number; color: string; label: string }) {
  const stroke = (SERIES_COLORS as string[]).includes(color) ? `var(--${color})` : color
  const dashoffset = 201 * (1 - pct / 100)
  return (
    <div className="gauge">
      <div className="gwrap">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="32" fill="none" stroke="var(--card-2)" strokeWidth="7" />
          <circle
            cx="40"
            cy="40"
            r="32"
            fill="none"
            stroke={stroke}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray="201"
            strokeDashoffset={dashoffset}
            transform="rotate(-90 40 40)"
          />
        </svg>
        <span className="val">{pct}%</span>
      </div>
      <span className="lab">{label}</span>
    </div>
  )
}

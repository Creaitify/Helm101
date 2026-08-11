import type { KpiMetric } from '@/lib/types'

export function StatTile({ metric }: { metric: KpiMetric }) {
  const color = `var(--${metric.color})`
  const gradId = `fill-${metric.label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
  const pts = metric.sparkline
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const w = 300
  const stepX = pts.length > 1 ? w / (pts.length - 1) : 0
  const coords = pts.map((p, i) => {
    const x = i * stepX
    const norm = (p - min) / span
    const y = 40 - norm * 28
    return `${x},${y}`
  })
  const line = coords.join(' ')
  const area = `M${coords[0]} L${coords.slice(1).join(' ')} ${w},46 0,46Z`

  return (
    <div className="kpi">
      <div className="kl">{metric.label}</div>
      <div className="kv">{metric.value}</div>
      <div className={`kd ${metric.direction}`}>{metric.deltaLabel}</div>
      <svg className="fill" viewBox="0 0 300 46" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <polyline fill="none" stroke={color} strokeWidth="1.8" points={line} />
      </svg>
    </div>
  )
}

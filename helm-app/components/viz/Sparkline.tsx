export function Sparkline({ points, color }: { points: number[]; color: string }) {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const w = 100
  const stepX = points.length > 1 ? w / (points.length - 1) : 0
  const coords = points.map((p, i) => {
    const x = i * stepX
    const norm = (p - min) / span
    const y = 24 - norm * 22
    return `${x},${y}`
  })
  return (
    <svg viewBox="0 0 100 26" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.8" points={coords.join(' ')} />
    </svg>
  )
}

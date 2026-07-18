export function DeltaBadge({ direction, children }: { direction: 'up' | 'down' | 'flat'; children: React.ReactNode }) {
  return <span className={`md ${direction}`}>{children}</span>
}

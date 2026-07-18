export function SplitBar({ segments }: { segments: { pct: number; color: string }[] }) {
  return (
    <div className="msplit">
      {segments.map((seg, i) => (
        <i key={i} style={{ width: `${seg.pct}%`, background: seg.color }} />
      ))}
    </div>
  )
}

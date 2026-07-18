export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="ec">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

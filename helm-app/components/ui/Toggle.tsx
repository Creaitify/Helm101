export function Toggle({ on, label, onClick }: { on?: boolean; label?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={!!on}
      aria-label={label ?? 'Toggle'}
      onClick={onClick}
    />
  )
}

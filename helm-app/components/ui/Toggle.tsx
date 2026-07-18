export function Toggle({ on, label }: { on?: boolean; label?: string }) {
  return (
    <button
      className={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={!!on}
      aria-label={label ?? 'Toggle'}
    />
  )
}

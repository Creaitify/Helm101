export function Toggle({ on }: { on?: boolean }) {
  return <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={!!on} />
}

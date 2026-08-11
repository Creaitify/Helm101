const MAP = {
  healthy: 'on', active: 'on', live: 'on',
  degraded: 'rev', invited: 'rev', review: 'rev',
  paused: 'off', disconnected: 'off', draft: 'off',
} as const

export function StatusPill({ status }: { status: keyof typeof MAP }) {
  return <span className={`status ${MAP[status]}`}><i />{status}</span>
}

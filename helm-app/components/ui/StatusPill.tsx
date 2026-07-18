const MAP = { healthy: 'on', active: 'on', degraded: 'rev', invited: 'rev', paused: 'off' } as const

export function StatusPill({ status }: { status: keyof typeof MAP }) {
  return <span className={`status ${MAP[status]}`}><i />{status}</span>
}

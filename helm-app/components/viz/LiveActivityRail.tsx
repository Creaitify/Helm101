import type { ActivityEvent } from '@/lib/types'

const TAG_CLASS: Record<NonNullable<ActivityEvent['tag']>, string> = {
  ERR: 'tagx err',
  REVIEW: 'tagx retry',
}

export function LiveActivityRail({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="rail">
      <div className="rail-h">
        <b><i />Live Activity</b>
        <span className="pill">auto</span>
      </div>
      {events.map((event, i) => (
        <div className="ev" key={i}>
          <span className="dot" style={{ background: `var(--${event.dot})` }} />
          <div className="m">
            <div className="t">
              {event.title}
              {event.tag && <span className={TAG_CLASS[event.tag]}> {event.tag}</span>}
            </div>
            <div className="s">{event.sub}</div>
          </div>
          <div className="r">
            <div className="lat">{event.latency}</div>
            <div className="tok">{event.tokens}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

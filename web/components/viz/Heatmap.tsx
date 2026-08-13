import { Fragment } from 'react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const COLS = ['12a', '2a', '4a', '6a', '8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p']
const SCALE = [
  'rgba(148,163,184,.10)',
  'rgba(139,92,246,.22)',
  'rgba(139,92,246,.4)',
  'rgba(99,102,241,.5)',
  'rgba(56,189,248,.55)',
  'rgba(52,211,153,.6)',
  'rgba(52,211,153,.8)',
  '#34d399',
  '#34d399',
]

export function Heatmap({ rows }: { rows: number[][] }) {
  return (
    <div className="heat">
      <div></div>
      {COLS.map((c) => (
        <div className="hh" key={c}>{c}</div>
      ))}
      {rows.map((row, i) => (
        <Fragment key={i}>
          <div className="hr">{DAYS[i]}</div>
          {row.map((v, j) => (
            <div
              className="hc"
              key={j}
              style={{ background: SCALE[v], cursor: 'pointer' }}
              title={`${DAYS[i]} @ ${COLS[j]} — ${Math.round(v * 14 + 10)} checkups (activity score: ${v}/8)`}
            />
          ))}
        </Fragment>
      ))}
    </div>
  )
}

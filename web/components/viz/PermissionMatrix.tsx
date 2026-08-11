import type { PermissionRow, Role } from '@/lib/types'

const ROLES: { key: Role; label: string }[] = [
  { key: 'master', label: 'Master' },
  { key: 'agency', label: 'Agency' },
  { key: 'strategist', label: 'Strat.' },
  { key: 'creative', label: 'Creative' },
  { key: 'analyst', label: 'Analyst' },
  { key: 'viewer', label: 'Viewer' },
]

const CHK: Record<'yes' | 'no' | 'partial', { cls: string; glyph: string }> = {
  yes: { cls: 'y', glyph: '✓' },
  partial: { cls: 'p', glyph: '◐' },
  no: { cls: 'n', glyph: '·' },
}

export function PermissionMatrix({ rows }: { rows: PermissionRow[] }) {
  return (
    <table className="matrix">
      <thead>
        <tr>
          <th>Capability</th>
          {ROLES.map((r) => (
            <th key={r.key}>{r.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.capability}>
            <td>{row.capability}</td>
            {ROLES.map((r) => {
              const state = CHK[row.roles[r.key]]
              return (
                <td key={r.key}>
                  <span className={`chk ${state.cls}`}>{state.glyph}</span>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

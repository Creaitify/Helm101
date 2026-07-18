import type { ReactNode } from 'react'

export interface DataTableColumn {
  key: string
  label: string
  align?: 'r'
  render?: (row: any) => ReactNode
}

export function DataTable({ columns, rows }: { columns: DataTableColumn[]; rows: any[] }) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={col.align === 'r' ? 'r' : undefined}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <td key={col.key} className={col.align === 'r' ? 'r' : undefined}>
                {col.render ? col.render(row) : row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

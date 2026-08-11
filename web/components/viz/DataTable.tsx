import type { ReactNode } from 'react'

export interface DataTableColumn<T extends object> {
  key: keyof T
  label: string
  align?: 'r'
  render?: (row: T) => ReactNode
}

export function DataTable<T extends object>({ columns, rows }: { columns: DataTableColumn<T>[]; rows: T[] }) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={String(col.key)} className={col.align === 'r' ? 'r' : undefined}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <td key={String(col.key)} className={col.align === 'r' ? 'r' : undefined}>
                {col.render ? col.render(row) : String(row[col.key] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

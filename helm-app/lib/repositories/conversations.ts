import 'server-only'
import type { TenantQueryTransaction } from '../server/tenant-context'
import type { PromptTemplate } from '../types'

export async function listPromptTemplates(tx: TenantQueryTransaction): Promise<PromptTemplate[]> {
  const rows = await tx.query<{ external_ref: string; title: string; body: string }>(
    'select external_ref, title, body from prompt_templates order by created_at asc',
  )
  return rows.map((row) => ({ id: row.external_ref, title: row.title, body: row.body }))
}

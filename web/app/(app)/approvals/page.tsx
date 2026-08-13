import { getApprovals } from '@/lib/data'
import { getLivePendingApprovals } from './actions'
import { ApprovalsView } from './ApprovalsView'

export default async function ApprovalsPage() {
  const [items, liveItems] = await Promise.all([
    getApprovals(),
    getLivePendingApprovals().catch(() => []),
  ])

  // Merge live items with unique IDs first
  const existingIds = new Set(liveItems.map((it) => it.id))
  const merged = [...liveItems, ...items.filter((it) => !existingIds.has(it.id))]

  return <ApprovalsView items={merged} />
}


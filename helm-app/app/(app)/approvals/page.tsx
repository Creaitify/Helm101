import { getApprovals } from '@/lib/data'
import { ApprovalsView } from './ApprovalsView'

export default async function ApprovalsPage() {
  const items = await getApprovals()
  return <ApprovalsView items={items} />
}

import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { CheckCircle } from 'lucide-react'

export default function ApprovalsPage() {
  return (
    <div className="content">
      <div className="phead"><div><h1>Approvals Inbox</h1><p>Human-in-the-loop — agents propose, you dispose</p></div></div>
      <Card>
        <EmptyState icon={<CheckCircle />} title="Approvals Inbox">
          Every action above a tenant's autonomy threshold lands here: budget shifts, creative ships, suppression lists — approve, edit, or reject, then the agent resumes from checkpoint.
        </EmptyState>
      </Card>
    </div>
  )
}

import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { LineChart } from 'lucide-react'

export default function CampaignsPage() {
  return (
    <div className="content">
      <div className="phead"><div><h1>Campaigns</h1><p>List + detail of every campaign across Meta &amp; Google</p></div></div>
      <Card>
        <EmptyState icon={<LineChart />} title="Campaign View">
          Full campaign list, status pills, budget pacing, and drill-down into ad groups + creatives. Built in the implementation plan — this nav slot is wired and ready.
        </EmptyState>
      </Card>
    </div>
  )
}

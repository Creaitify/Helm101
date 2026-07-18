import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Image } from 'lucide-react'

export default function StudioPage() {
  return (
    <div className="content">
      <div className="phead"><div><h1>Creative Studio</h1><p>Brief → generate → review → ship</p></div></div>
      <Card>
        <EmptyState icon={<Image />} title="Creative Studio">
          Brief form → image/video/copy generation → variants gallery → SEBI compliance gate → ship. Wired and ready for the build.
        </EmptyState>
      </Card>
    </div>
  )
}

import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { MessageSquare } from 'lucide-react'

export default function WorkspacePage() {
  return (
    <div className="content">
      <div className="phead"><div><h1>Workspace</h1><p>Embedded LLM workspace — your internal ChatGPT/Claude</p></div></div>
      <Card>
        <EmptyState icon={<MessageSquare />} title="LLM Workspace">
          Model-select chat routed via the Gateway, grounded retrieval with citations, prompt library, file upload. This is where Cognivo's airy chat style will shine.
        </EmptyState>
      </Card>
    </div>
  )
}

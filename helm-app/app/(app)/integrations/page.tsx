import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Plug } from 'lucide-react'

export default function IntegrationsPage() {
  return (
    <div className="content">
      <div className="phead"><div><h1>Integrations</h1><p>Connect &amp; manage marketing platforms via MCP</p></div></div>
      <Card>
        <EmptyState icon={<Plug />} title="Integrations">
          Connect Meta, Google, GA4, WhatsApp, Instantly, Mailchimp, n8n via OAuth 2.1 — health, scopes, per-tenant credentials. (Live status is on System Config.)
        </EmptyState>
      </Card>
    </div>
  )
}

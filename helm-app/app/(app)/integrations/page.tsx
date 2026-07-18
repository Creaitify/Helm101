import { getIntegrationsFull } from '@/lib/data'
import { IntegrationsView } from './IntegrationsView'

export default async function IntegrationsPage() {
  const integrations = await getIntegrationsFull()
  return <IntegrationsView integrations={integrations} />
}

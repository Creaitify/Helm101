import { getCampaignsFull } from '@/lib/data'
import { CampaignsView } from './CampaignsView'

export default async function CampaignsPage() {
  const campaigns = await getCampaignsFull()
  return <CampaignsView campaigns={campaigns} />
}

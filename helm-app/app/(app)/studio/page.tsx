import { getBriefDefaults } from '@/lib/data'
import { StudioView } from './StudioView'

export default async function StudioPage() {
  const brief = await getBriefDefaults()
  return <StudioView brief={brief} />
}

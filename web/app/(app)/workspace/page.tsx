import { getPromptTemplates } from '@/lib/data'
import { WorkspaceView } from './WorkspaceView'

export default async function WorkspacePage() {
  const templates = await getPromptTemplates()
  return <WorkspaceView templates={templates} />
}

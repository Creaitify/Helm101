import { getPromptTemplates } from '@/lib/data'
import { allowLocalAnalyst, isDemoMode } from '@/lib/server/env'
import { WorkspaceView } from './WorkspaceView'

export default async function WorkspacePage() {
  const templates = await getPromptTemplates()
  // `live` decides copy, not behaviour: the ask action re-derives the mode
  // server-side on every call, so a stale prop can mislabel but never
  // misroute a question. Local-analyst mode counts as live: questions reach
  // the real gateway even while the rest of the shell is demo.
  return <WorkspaceView templates={templates} live={!isDemoMode() || allowLocalAnalyst()} />
}

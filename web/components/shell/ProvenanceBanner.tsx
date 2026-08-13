/**
 * The one honest line above every surface: where the data on screen comes
 * from. Until the Phase 2 domain endpoints exist, lib/data serves fixtures in
 * BOTH modes (see lib/data/index.ts), so live mode gets a banner too -- the
 * only live-wired surface today is the Workspace Analyst. Rendered by the
 * shell rather than per page so no surface can forget it.
 */
export function ProvenanceBanner({ mode }: { mode: 'demo' | 'live' }) {
  return (
    <div className="provenance" data-mode={mode} role="note">
      {mode === 'demo'
        ? 'Demo mode — synthetic sample data on every surface. Nothing shown here is live.'
        : 'Preview — Workspace chat is live via the Model Gateway; campaigns, approvals and analytics show sample data until the domain API lands.'}
    </div>
  )
}

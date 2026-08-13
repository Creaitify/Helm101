/**
 * Demo mode serves every surface from fixtures and skips the helm-api tenant
 * lookup. An explicit HELM_DEMO_MODE=true/false always wins; when unset, demo
 * is the default exactly when no HELM_API_BASE_URL is configured, so a fresh
 * checkout with an empty .env.local still renders the full UI with zero
 * setup. Computed per call (not snapshotted at module evaluation) so tests
 * can vary the environment.
 *
 * This lives OUTSIDE lib/server/ deliberately: proxy.ts needs it to decide
 * whether a request requires a session, and the proxy bundle cannot import a
 * module guarded by `server-only`. It still only ever runs on the server --
 * a client bundle has no HELM_* env vars, and nothing client-side imports it.
 * Everything else should keep importing it from lib/server/env.
 */
export function isDemoMode(): boolean {
  const explicit = process.env.HELM_DEMO_MODE?.trim() || undefined
  if (explicit !== undefined) return explicit === 'true'
  return !(process.env.HELM_API_BASE_URL?.trim() || undefined)
}

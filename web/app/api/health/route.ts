import { env, isDemoMode } from '@/lib/server/env'

export const dynamic = 'force-dynamic'

/**
 * BFF liveness only. Deliberately does NOT proxy helm-api's /api/v1/health:
 * this route is unauthenticated (proxy.ts exempts it), so proxying would let
 * anonymous callers induce server-side requests to the backend, and would
 * couple this service's liveness to the API's availability -- an orchestrator
 * probing this URL must not restart a healthy BFF during an API outage.
 * Probe helm-api's own /api/v1/health directly instead.
 */
export async function GET() {
  return Response.json({
    status: 'ok',
    demoMode: isDemoMode(),
    helmApiConfigured: Boolean(env.helmApiBaseUrl),
  })
}

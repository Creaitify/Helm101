import { checkDatabaseConnection } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const database = await checkDatabaseConnection()
    return Response.json({ status: database.connected ? 'ok' : 'degraded', database }, { status: database.connected ? 200 : 503 })
  } catch {
    return Response.json({ status: 'degraded', database: { configured: true, connected: false } }, { status: 503 })
  }
}

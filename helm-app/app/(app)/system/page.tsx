import { Card } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { DataTable } from '@/components/viz/DataTable'
import { StatusPill } from '@/components/ui/StatusPill'
import { getGuardrails, getFeatureFlags, getIntegrations } from '@/lib/data'
import type { IntegrationRow } from '@/lib/types'

export default async function SystemPage() {
  const [guardrails, featureFlags, integrations] = await Promise.all([
    getGuardrails(),
    getFeatureFlags(),
    getIntegrations(),
  ])

  return (
    <div className="content page" data-page="system">
      <div className="phead">
        <div>
          <h1>
            System Configuration <span className="tag">MASTER CONSOLE</span>
          </h1>
          <p>Guardrails, feature flags, integration health · enforced below the agents</p>
        </div>
        <span className="pill">tenant-scoped</span>
      </div>

      <div className="bento">
        <Card className="col6">
          <div className="card-h">
            <div>
              <h3>Guardrails</h3>
              <div className="sub">input + output safety on every LLM call</div>
            </div>
            <span className="pill e">all active</span>
          </div>
          <div className="flags">
            {guardrails.map((flag) => (
              <div className="flag" key={flag.title}>
                <div className="fn">
                  <div className="t">{flag.title}</div>
                  <div className="d">{flag.desc}</div>
                </div>
                <Toggle on={flag.on} label={`Toggle ${flag.title}`} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="col6">
          <div className="card-h">
            <div>
              <h3>Feature Flags</h3>
              <div className="sub">platform behaviour toggles</div>
            </div>
          </div>
          <div className="flags">
            {featureFlags.map((flag) => (
              <div className="flag" key={flag.title}>
                <div className="fn">
                  <div className="t">{flag.title}</div>
                  <div className="d">{flag.desc}</div>
                </div>
                <Toggle on={flag.on} label={`Toggle ${flag.title}`} />
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ gridColumn: 'span 12' }}>
          <div className="card-h">
            <div>
              <h3>Integration Health</h3>
              <div className="sub">MCP servers · per-tenant credentials via vault</div>
            </div>
            <span className="pill e">{integrations.filter((i) => i.status === 'healthy').length} connected</span>
          </div>
          <DataTable
            columns={[
              { key: 'name', label: 'MCP Server', render: (r: IntegrationRow) => <span className="name">{r.name}</span> },
              { key: 'auth', label: 'Auth' },
              { key: 'status', label: 'Status', render: (r: IntegrationRow) => <StatusPill status={r.status} /> },
              { key: 'lastSync', label: 'Last sync', align: 'r' },
              { key: 'calls', label: 'Calls 24h', align: 'r' },
              {
                key: 'errors',
                label: 'Errors',
                align: 'r',
                render: (r: IntegrationRow) => <span className={r.errors > 0 ? 'over' : undefined}>{r.errors}</span>,
              },
            ]}
            rows={integrations}
          />
        </Card>
      </div>
    </div>
  )
}

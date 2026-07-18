import { Card } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { AIInsightChip } from '@/components/viz/AIInsightChip'
import { DataTable } from '@/components/viz/DataTable'
import { SplitBar } from '@/components/viz/SplitBar'
import { getGatewayBudgets, getRouting, getModelSplit } from '@/lib/data'

const GUARDRAIL_FLAGS = [
  { title: 'Response cache', desc: '41% hit rate · saves ~$180/mo', on: true },
  { title: 'Per-tenant rate limits', desc: '120 req/min · burst 240', on: true },
  { title: 'Provider failover', desc: 'retry on 5xx → secondary provider', on: true },
  { title: 'Semantic cache (embeddings)', desc: 'dedupe near-identical prompts', on: false },
]

export default async function GatewayPage() {
  const [budgets, routing, modelSplit] = await Promise.all([getGatewayBudgets(), getRouting(), getModelSplit()])

  return (
    <div className="content page" data-page="gateway">
      <div className="phead">
        <div>
          <h1>
            Model Gateway <span className="tag">MASTER CONSOLE</span>
          </h1>
          <p>The single door to every model provider · routing, budgets, guardrails, key custody</p>
        </div>
        <span className="pill v">4 providers</span>
      </div>

      <div className="bento">
        <Card className="col6">
          <div className="card-h">
            <div>
              <h3>Provider Budgets</h3>
              <div className="sub">spend this month</div>
            </div>
            <span className="pill e">0 egress violations</span>
          </div>
          <div className="budget">
            {budgets.map((budget, i) => {
              const pct = budget.cap ? (budget.spent / budget.cap) * 100 : 0
              const isLast = i === budgets.length - 1
              const amber = isLast && pct > 90
              return (
                <div className="brow" key={budget.provider}>
                  <div className="bt">
                    <span>{budget.provider}</span>
                    <span className="bv">
                      ${budget.spent} / ${budget.cap}
                    </span>
                  </div>
                  <div className="bbar">
                    <i
                      style={{
                        width: `${pct}%`,
                        background: amber
                          ? 'linear-gradient(90deg,var(--amber),var(--bad))'
                          : 'linear-gradient(90deg,var(--violet),var(--indigo))',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <AIInsightChip>
            Veo 3.1 is at 97% of budget — routing will fail over to cached renders at 100%.
          </AIInsightChip>
        </Card>

        <Card className="col6">
          <div className="card-h">
            <div>
              <h3>Routing Table</h3>
              <div className="sub">logical task → concrete model</div>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'task', label: 'Logical task', render: (r) => <span className="name">{r.task}</span> },
              { key: 'model', label: 'Provider · model' },
              { key: 'calls', label: 'Calls 24h', align: 'r' },
              { key: 'latency', label: 'Avg latency', align: 'r' },
            ]}
            rows={routing}
          />
        </Card>

        <Card className="col6">
          <div className="card-h">
            <div>
              <h3>Model Split</h3>
              <div className="sub">8.4M tokens this period</div>
            </div>
          </div>
          <SplitBar segments={modelSplit.map((m) => ({ pct: m.pct, color: `var(--${m.color})` }))} />
          <div>
            {modelSplit.map((m) => (
              <div className="mrow" key={m.model}>
                <span className="sw" style={{ background: `var(--${m.color})` }} />
                <span className="nm">{m.model}</span>
                <span className="tk">{m.tokens}</span>
                <span className="pc">{m.pct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="col6">
          <div className="card-h">
            <div>
              <h3>Gateway Guardrails</h3>
              <div className="sub">runs on every model call</div>
            </div>
            <span className="pill">middleware</span>
          </div>
          <div className="flags">
            {GUARDRAIL_FLAGS.map((flag) => (
              <div className="flag" key={flag.title}>
                <div className="fn">
                  <div className="t">{flag.title}</div>
                  <div className="d">{flag.desc}</div>
                </div>
                <Toggle on={flag.on} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

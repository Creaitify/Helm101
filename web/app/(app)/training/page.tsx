import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/viz/DataTable'
import { getTrainingJobs } from '@/lib/data'
import type { TrainingJob } from '@/lib/types'

const STATUS_CLASS: Record<TrainingJob['status'], string> = {
  running: 'rev',
  deployed: 'on',
  queued: 'off',
  shadow: 'rev',
}

const LEADERBOARD = [
  { code: 'v2', grad: 'linear-gradient(135deg,var(--emerald),var(--sky))', title: 'Lead-Score v2', sub: 'AUC 0.88 · +0.05', pct: 88, stat: 'PASS', statClass: 'ok', statColor: undefined },
  { code: 'v3', grad: 'linear-gradient(135deg,var(--violet),var(--sky))', title: 'Reply-Intent v3', sub: 'F1 0.79 · training', pct: 79, stat: 'WIP', statClass: undefined, statColor: 'var(--warn)' },
  { code: 'v1', grad: 'linear-gradient(135deg,var(--amber),var(--rose))', title: 'Creative-Rank v1', sub: 'NDCG 0.71 · baseline', pct: 71, stat: 'HOLD', statClass: undefined, statColor: 'var(--faint)' },
] as const

export default async function TrainingPage() {
  const jobs = await getTrainingJobs()

  return (
    <div className="content page" data-page="training">
      <div className="phead">
        <div>
          <h1>
            Training & Evals <span className="tag">MASTER CONSOLE</span>
          </h1>
          <p>Custom models (your IP) · fine-tunes, datasets, eval scores, deployment</p>
        </div>
        <Button variant="primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New training job
        </Button>
      </div>

      <div className="bento">
        <Card className="col8">
          <div className="card-h">
            <div>
              <h3>Jobs & Models</h3>
              <div className="sub">custom algorithms graduating from rules → learned</div>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'model', label: 'Model', render: (r) => <span className="name">{r.model}</span> },
              { key: 'type', label: 'Type' },
              {
                key: 'status',
                label: 'Status',
                render: (r: TrainingJob) => (
                  <span className={`status ${STATUS_CLASS[r.status]}`}>
                    <i />
                    {r.status}
                  </span>
                ),
              },
              { key: 'metric', label: 'Metric', align: 'r' },
              { key: 'progress', label: 'Progress', align: 'r' },
            ]}
            rows={jobs}
          />
        </Card>

        <Card className="col4">
          <div className="card-h">
            <div>
              <h3>Eval Leaderboard</h3>
              <div className="sub">held-out test set</div>
            </div>
          </div>
          <div className="lead">
            {LEADERBOARD.map((row) => (
              <div className="lrow" key={row.code}>
                <div className="lthumb" style={{ background: row.grad }}>
                  {row.code}
                </div>
                <div className="lmeta">
                  <div className="t">{row.title}</div>
                  <div className="s">{row.sub}</div>
                  <div className="bar">
                    <i style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
                <div className={`lstat${row.statClass ? ` ${row.statClass}` : ''}`} style={row.statColor ? { color: row.statColor } : undefined}>
                  {row.stat}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

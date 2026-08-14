import { Suspense } from 'react'
import { AgentCard } from '@/components/viz/AgentCard'
import { getAgents } from '@/lib/data'
import { AgentConsole } from './AgentConsole'

export default async function AgentsPage() {
  const agents = await getAgents()

  return (
    <div className="content page" data-page="agents">
      <div className="phead">
        <div>
          <h1>
            Agent Fleet <span className="tag">MASTER CONSOLE</span>
          </h1>
          <p>4 connected capabilities · supervised by Governor · gateway-routed runtime</p>
        </div>
        <span className="pill v">checkpointer healthy</span>
      </div>

      <div className="kill">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 2v10M18.4 6.6a9 9 0 11-12.8 0" />
        </svg>
        <div className="kt">
          <b>Global Kill Switch</b>
          <div>freezes all agent autonomy + model egress instantly · last drill 4d ago</div>
        </div>
        <button className="kb">ARM KILL SWITCH</button>
      </div>

      <div className="agent-grid">
        {agents.map((agent) => (
          <AgentCard key={agent.code} agent={agent} />
        ))}
      </div>
      <Suspense fallback={null}>
        <AgentConsole />
      </Suspense>
    </div>
  )
}

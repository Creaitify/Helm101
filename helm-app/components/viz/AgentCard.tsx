import type { Agent } from '@/lib/types'
import { Toggle } from '@/components/ui/Toggle'

const TIER_CLASS: Record<Agent['tier'], string> = {
  auto: 'auto',
  propose: 'prop',
  human: 'man',
}
const TIER_LABEL: Record<Agent['tier'], string> = {
  auto: 'AUTO',
  propose: 'PROPOSE',
  human: 'HUMAN',
}

export function AgentCard({ agent }: { agent: Agent }) {
  const [a, b] = agent.grad
  return (
    <div className="agent">
      <div className="ah">
        <div className="aic" style={{ background: `linear-gradient(135deg,var(--${a}),var(--${b}))` }}>
          {agent.code}
        </div>
        <div>
          <div className="an">{agent.name}</div>
          <div className="arole">{agent.role}</div>
        </div>
        <span className={`tier ${TIER_CLASS[agent.tier]}`}>{TIER_LABEL[agent.tier]}</span>
      </div>
      <div className="astats">
        <div className="astat">
          <div className="l">Runs 24h</div>
          <div className="v">{agent.runs}</div>
        </div>
        <div className="astat">
          <div className="l">Success</div>
          <div className="v ok">{agent.success}</div>
        </div>
      </div>
      <div className="afoot">
        {agent.tokens} tok · {agent.cost}
        <Toggle on={agent.enabled} />
      </div>
    </div>
  )
}

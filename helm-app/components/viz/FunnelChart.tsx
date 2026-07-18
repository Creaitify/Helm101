import type { FunnelStage } from '@/lib/types'

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="funnel">
      {stages.map((stage, i) => (
        <div key={stage.label}>
          <div className="fs">
            <span className="fl">{stage.label}</span>
            <div className="fbw">
              <div
                className="fb"
                style={{
                  width: `${stage.widthPct}%`,
                  background: i === stages.length - 1
                    ? 'linear-gradient(90deg,var(--emerald),var(--sky))'
                    : 'linear-gradient(90deg,var(--violet),var(--indigo))',
                }}
              >
                {stage.display}
              </div>
            </div>
            <span className="fv">{stage.display}</span>
          </div>
          {stage.convLabel && (
            <div className="fconv">
              <b>{stage.convLabel}</b>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

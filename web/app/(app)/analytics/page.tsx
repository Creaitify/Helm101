import { Card } from '@/components/ui/Card'
import { SegControl } from '@/components/ui/SegControl'
import { StatTile } from '@/components/viz/StatTile'
import { TrendChart } from '@/components/viz/TrendChart'
import { AIInsightChip } from '@/components/viz/AIInsightChip'
import { LiveActivityRail } from '@/components/viz/LiveActivityRail'
import { FunnelChart } from '@/components/viz/FunnelChart'
import { SplitBar } from '@/components/viz/SplitBar'
import { RadialGauge } from '@/components/viz/RadialGauge'
import { Heatmap } from '@/components/viz/Heatmap'
import { getKpis, getMetricStrip, getFunnel, getChannels, getActivity, getAnalyticsPanels } from '@/lib/data'

export default async function AnalyticsPage() {
  const [kpis, metricStrip, funnel, channels, activity, panels] = await Promise.all([
    getKpis(),
    getMetricStrip(),
    getFunnel(),
    getChannels(),
    getActivity(),
    getAnalyticsPanels(),
  ])

  const channelSpendTotal = channels.reduce((sum, c) => sum + c.spend, 0)
  const channelSegments = channels.map((c) => ({
    pct: channelSpendTotal ? (c.spend / channelSpendTotal) * 100 : 0,
    color: `var(--${c.color})`,
  }))

  return (
    <div className="content page" data-page="analytics">
      <div className="phead">
        <div>
          <h1>
            Performance Overview <span className="tag">FINNOVATE · FHC ₹999</span>
          </h1>
          <p>Full-funnel campaign intelligence · last 30 days vs. prior period</p>
        </div>
        <SegControl options={['24H', '7D', '30D', 'QTD', 'YTD']} value="30D" />
      </div>

      <div className="hero">
        {kpis.map((metric) => (
          <StatTile key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="mstrip">
        {metricStrip.map((cell) => (
          <div className="mcell" key={cell.label}>
            <span className="ml">{cell.label}</span>
            <span className="mv">{cell.value}</span>
            <span className={`md ${cell.direction}`}>{cell.deltaLabel}</span>
          </div>
        ))}
      </div>

      <div className="grid">
        <Card>
          <div className="card-h">
            <div>
              <h3>Spend · Revenue · Checkups</h3>
              <div className="sub">daily · 30d + 7d forecast</div>
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--amber)' }} />Spend</span>
              <span><i style={{ background: 'var(--violet-2)' }} />Revenue</span>
              <span><i style={{ background: 'var(--emerald)' }} />Checkups</span>
            </div>
          </div>
          <TrendChart />
          <AIInsightChip>
            AI insight · revenue is outpacing spend; forecast suggests +9% checkups next week if pacing holds.
          </AIInsightChip>
        </Card>
        <LiveActivityRail events={activity} />
      </div>

      <div className="bento">
        <Card className="col4">
          <div className="card-h">
            <div>
              <h3>Conversion Funnel</h3>
              <div className="sub">impression → advisory</div>
            </div>
            <span className="pill v">30D</span>
          </div>
          <FunnelChart stages={funnel} />
        </Card>

        <Card className="col4">
          <div className="card-h">
            <div>
              <h3>Channel Mix</h3>
              <div className="sub">₹8.4L spend · by source</div>
            </div>
          </div>
          <SplitBar segments={channelSegments} />
          <div>
            {channels.map((channel) => (
              <div className="mrow" key={channel.name}>
                <span className="sw" style={{ background: `var(--${channel.color})` }} />
                <span className="nm">{channel.name}</span>
                <span className="tk">
                  ₹{(channel.spend / 1000).toFixed(0)}K · {channel.checkups} ck
                </span>
                <span className={`pc ${channel.roas >= 2.4 ? 'ok' : channel.roas < 2 ? 'over' : ''}`.trim()}>
                  ₹{channel.cac}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="col4">
          <div className="card-h">
            <div>
              <h3>Goal Attainment</h3>
              <div className="sub">vs. monthly targets</div>
            </div>
          </div>
          <div className="gauges">
            {panels.goalGauges.map((gauge) => (
              <RadialGauge key={gauge.label} pct={gauge.pct} color={gauge.color} label={gauge.label} />
            ))}
          </div>
        </Card>

        <Card className="col5">
          <div className="card-h">
            <div>
              <h3>Performance Heatmap</h3>
              <div className="sub">checkups · day × hour block</div>
            </div>
            <span className="pill e">peak Tue 8pm</span>
          </div>
          <Heatmap rows={panels.heatmapRows} />
        </Card>

        <Card className="col4">
          <div className="card-h">
            <div>
              <h3>Creative Leaderboard</h3>
              <div className="sub">top variants by CAC</div>
            </div>
          </div>
          <div className="lead">
            {panels.leaderboard.map((row) => (
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
                <div className="lstat">
                  {row.stat}
                  <small>CAC</small>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="col3">
          <div className="card-h">
            <div>
              <h3>Approvals</h3>
              <div className="sub">waiting on you</div>
            </div>
            <span className="pill r">3</span>
          </div>
          <div className="lead">
            {panels.approvalsPreview.map((row) => (
              <div className="lrow" key={row.code}>
                <div className="lthumb" style={{ background: row.color, width: 32, height: 32 }}>
                  {row.code}
                </div>
                <div className="lmeta">
                  <div className="t">{row.title}</div>
                  <div className="s">{row.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="foot-note">v4 · Open Sans · sidebar-routed · mock data</div>
    </div>
  )
}

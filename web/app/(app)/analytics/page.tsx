import Link from 'next/link'
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
import { MiniApprovalsWidget } from '@/components/viz/MiniApprovalsWidget'
import { MessageSquare, Sparkles } from 'lucide-react'
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/workspace?q=Summarize+last+30d+funnel+conversion+bottlenecks+and+CAC+dispersion&tag=analytics:30d_trends"
            className="ask-analyst-chip"
          >
            <MessageSquare width={13} height={13} />
            Ask Analyst on 30D Trends
          </Link>
          <SegControl options={['24H', '7D', '30D', 'QTD', 'YTD']} value="30D" />
        </div>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <AIInsightChip>
              AI insight · revenue is outpacing spend; forecast suggests +9% checkups next week if pacing holds.
            </AIInsightChip>
            <Link
              href="/workspace?q=Why+is+revenue+outpacing+spend+and+how+should+we+allocate+the+forecasted+9+percent+checkup+lift%3F&tag=analytics:spend_forecast"
              style={{ fontSize: 11.5, color: 'var(--violet-2)', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              Drill-down with AI <MessageSquare width={11} height={11} />
            </Link>
          </div>
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
                <div className="lstat" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div>
                    {row.stat}
                    <small>CAC</small>
                  </div>
                  <Link
                    href={`/studio`}
                    style={{ fontSize: 10, color: 'var(--violet-2)', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}
                  >
                    <Sparkles width={10} height={10} /> Remix
                  </Link>
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
            <span className="pill r">{panels.approvalsPreview.length}</span>
          </div>
          <MiniApprovalsWidget initialItems={panels.approvalsPreview} />
        </Card>
      </div>

      <div className="foot-note">v4 · Open Sans · sidebar-routed · mock data</div>
    </div>
  )
}

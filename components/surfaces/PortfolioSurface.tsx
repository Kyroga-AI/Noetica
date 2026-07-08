'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * PortfolioSurface — Portfolio Management lens for the IFM demo.
 *
 * Pulls the full portfolio lens from /api/portfolio/lens and renders:
 *   • Signal snapshot (combined LFL vs consensus, CI, conviction)
 *   • Prophet decomposition waterfall (6 components)
 *   • Historical LFL vs consensus chart
 *   • Supply chain events + cost/availability index
 *   • Location traffic by state / archetype
 *   • News catalyst feed with materiality scores
 *   • Causal governance summary
 *   • KG enrichment badges
 *
 * All data is sourced from the backend API — no hard-coded values in the UI.
 */

type SignalSnapshot = {
  combined_lfl_pct: number
  consensus_lfl_pct: number
  alpha_pp: number
  confidence: number
  ci_lower: number
  ci_upper: number
  direction: 'bullish' | 'bearish' | 'neutral'
  conviction: 'high' | 'medium' | 'low'
  asic_summary: string
}

type SignalComponent = {
  name: string
  estimate_pct: number
  confidence: number
  source: string
  role?: 'primary' | 'context'
}

type HistoricalLFL = { period: string; reported: number; consensus: number }
type ForecastRow = { period: string; trend_estimate: number; seasonal_adj: number; combined_estimate: number; ci_lower: number; ci_upper: number }

type SupplyEvent = { id: string; description: string; severity: string; cost_impact_pct: number; availability_impact_pct: number; affected_suppliers: string[] }
type SupplyChain = {
  input_cost_index: number
  gross_availability_pct: number
  lfl_revision_pct: number
  active_events: SupplyEvent[]
  top_suppliers: Array<{ name: string; ingredient: string; spend_share: number }>
}

type StateBreakdown = { state: string; transactions: number; revenue: number; locations: number }
type ArchBreakdown = { archetype: string; transactions: number; revenue: number; locations: number; avg_busyness: number }
type TopStore = { name: string; state: string; archetype: string; iv_transactions: number; lfl_vs_base: number }
type Traffic = {
  network_total_transactions: number
  network_lfl_index: number
  iv_adjusted_lfl_pct: number
  state_breakdown: StateBreakdown[]
  archetype_breakdown: ArchBreakdown[]
  top_stores: TopStore[]
}

type NewsEvent = { headline: string; catalyst_type: string; materiality_score: number; sentiment: 'positive' | 'negative' | 'neutral'; academic_class: string; date: string }
type News = { net_materiality_score: number; sentiment_direction: string; catalyst_count: number; enriched_events: NewsEvent[] }

type Causal = { dag_count: number; dag_names: string[]; identification_strategies: string[]; primary_path: string[]; iv_first_stage_f: number }

type KGEntity = { label: string; kko_class: string; description: string }
type KG = { kko_entities: KGEntity[]; semantic_dimensions: string[]; ontology_coverage_note: string }

type Lens = {
  generated_at: string
  ticker: { ticker: string; name: string; exchange: string; sector: string; market_cap_aud_bn: number; store_count: number }
  signal: SignalSnapshot
  forecast: ForecastRow[]
  signal_components: SignalComponent[]
  historical_lfl: HistoricalLFL[]
  supply_chain: SupplyChain
  traffic: Traffic
  news: News
  causal: Causal
  kg: KG
  pm_narrative: string
}

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

const CONVICTION_COLOUR = { high: '#16a34a', medium: '#ca8a04', low: '#dc2626' }
const DIR_COLOUR = { bullish: '#16a34a', bearish: '#dc2626', neutral: '#6b7280' }
const SEVERITY_COLOUR: Record<string, string> = { severe: '#dc2626', moderate: '#ca8a04', minor: '#2563eb' }
const SENTIMENT_COLOUR = { positive: '#16a34a', negative: '#dc2626', neutral: '#6b7280' }

function Pill({ label, colour }: { label: string; colour: string }) {
  return (
    <span style={{ background: `${colour}18`, color: colour, border: `1px solid ${colour}40` }}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
      {label}
    </span>
  )
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {sub && <p className="text-xs text-[var(--color-text-tertiary)]">{sub}</p>}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 ${className}`}>
      {children}
    </div>
  )
}

// ── Signal Snapshot ───────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: SignalSnapshot }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">
              {signal.combined_lfl_pct > 0 ? '+' : ''}{signal.combined_lfl_pct.toFixed(1)}%
            </span>
            <span className="text-sm text-[var(--color-text-tertiary)]">LFL (YoY)</span>
            <Pill label={signal.direction} colour={DIR_COLOUR[signal.direction]} />
            <Pill label={`${signal.conviction} conviction`} colour={CONVICTION_COLOUR[signal.conviction]} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <span>vs consensus <strong className="tabular-nums">{signal.consensus_lfl_pct.toFixed(1)}%</strong></span>
            <span className="font-semibold" style={{ color: signal.alpha_pp >= 0 ? '#16a34a' : '#dc2626' }}>
              α {signal.alpha_pp >= 0 ? '+' : ''}{signal.alpha_pp.toFixed(2)}pp
            </span>
            <span>90% CI [{signal.ci_lower.toFixed(1)}, {signal.ci_upper.toFixed(1)}]</span>
            <span>confidence {(signal.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-tertiary)]">{signal.asic_summary}</p>
    </Card>
  )
}

// ── Prophet Decomposition ─────────────────────────────────────────────────────

function WaterfallBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const pct = Math.abs(value) / maxAbs * 100
  const colour = value >= 0 ? '#2563eb' : '#dc2626'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-4 flex-1 rounded bg-[var(--color-background-tertiary)]">
        <div style={{ width: `${pct}%`, background: colour, opacity: 0.75 }}
          className="absolute top-0 h-full rounded transition-all duration-500" />
      </div>
      <span className="w-14 text-right text-xs tabular-nums" style={{ color: value >= 0 ? '#2563eb' : '#dc2626' }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}pp
      </span>
    </div>
  )
}

function ComponentsCard({ components }: { components: SignalComponent[] }) {
  const primary = components.filter((c) => c.role !== 'context')
  const context = components.filter((c) => c.role === 'context')
  const maxAbs = Math.max(...components.map((c) => Math.abs(c.estimate_pct)))
  return (
    <Card>
      <SectionHeader title="Signal Decomposition" sub="IV base + additive revisions → combined estimate; trend/seasonal/holiday are decomposition context priced into the IV reading" />
      <div className="space-y-2">
        {primary.map((c) => (
          <div key={c.name}>
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--color-text-primary)] truncate max-w-[240px]">{c.name}</span>
              <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">conf {(c.confidence * 100).toFixed(0)}%</span>
            </div>
            <WaterfallBar value={c.estimate_pct} maxAbs={maxAbs} />
            <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{c.source}</p>
          </div>
        ))}
        {context.length > 0 && (
          <div className="mt-3 border-t border-[var(--color-border-tertiary)] pt-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">Decomposition context (priced into IV)</p>
            {context.map((c) => (
              <div key={c.name} className="mb-2 opacity-60">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[240px]">{c.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">conf {(c.confidence * 100).toFixed(0)}%</span>
                </div>
                <WaterfallBar value={c.estimate_pct} maxAbs={maxAbs} />
                <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{c.source}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Historical LFL Chart ──────────────────────────────────────────────────────

function LFLChart({ historical, forecast }: { historical: HistoricalLFL[]; forecast: ForecastRow[] }) {
  const all = [
    ...historical.map((d) => ({ period: d.period, reported: d.reported, consensus: d.consensus, forecast: null as number | null })),
    ...forecast.map((d) => ({ period: d.period, reported: null as number | null, consensus: null as number | null, forecast: d.combined_estimate })),
  ]
  const maxY = Math.max(...all.flatMap((d) => [d.reported ?? 0, d.consensus ?? 0, d.forecast ?? 0])) + 1
  const minY = Math.min(...all.flatMap((d) => [d.reported ?? 99, d.consensus ?? 99, d.forecast ?? 99])) - 0.5
  const H = 120, W = 580
  const xStep = W / (all.length - 1)
  const yScale = (v: number) => H - ((v - minY) / (maxY - minY)) * H

  function pts(values: (number | null)[]) {
    return values
      .map((v, i) => v !== null ? `${i * xStep},${yScale(v)}` : null)
      .filter(Boolean)
      .join(' ')
  }

  return (
    <Card>
      <SectionHeader title="Historical LFL + Forecast" sub="ASX quarterly disclosures vs consensus vs our signal" />
      <div className="overflow-x-auto">
        <svg viewBox={`0 -8 ${W} ${H + 32}`} style={{ width: '100%', minWidth: 340, height: 'auto' }}>
          {/* Grid lines */}
          {[...Array(5)].map((_, i) => {
            const y = (H / 4) * i
            const val = maxY - (maxY - minY) * (i / 4)
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={W} y2={y} stroke="var(--color-border-tertiary)" strokeWidth={0.5} />
                <text x={-2} y={y + 3} textAnchor="end" fontSize={8} fill="var(--color-text-tertiary)">{val.toFixed(1)}</text>
              </g>
            )
          })}
          {/* Forecast shading */}
          <rect x={historical.length * xStep} y={0} width={(forecast.length - 1) * xStep + 2} height={H} fill="var(--color-background-tertiary)" opacity={0.5} />
          {/* Reported line */}
          <polyline points={pts(all.map((d) => d.reported))} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeLinejoin="round" />
          {/* Consensus dashed */}
          <polyline points={pts(all.map((d) => d.consensus))} fill="none" stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 2" strokeLinejoin="round" />
          {/* Forecast dotted */}
          <polyline points={pts(all.map((d) => d.forecast))} fill="none" stroke="#16a34a" strokeWidth={1.5} strokeDasharray="4 2" strokeLinejoin="round" />
          {/* X labels */}
          {all.map((d, i) => (
            <text key={i} x={i * xStep} y={H + 10} textAnchor="middle" fontSize={7} fill="var(--color-text-tertiary)" transform={`rotate(-35 ${i * xStep} ${H + 10})`}>{d.period}</text>
          ))}
        </svg>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-[var(--color-text-tertiary)]">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-blue-600" />ASX reported</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-gray-400" style={{ borderTop: '1px dashed' }} />Consensus</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-green-600" />Our signal</span>
      </div>
    </Card>
  )
}

// ── Supply Chain ──────────────────────────────────────────────────────────────

function SupplyChainCard({ sc }: { sc: SupplyChain }) {
  return (
    <Card>
      <SectionHeader title="Supply Chain" sub="Natural experiment identification via exogenous cost shocks" />
      <div className="mb-3 flex gap-4 text-sm">
        <div>
          <div className="text-xs text-[var(--color-text-tertiary)]">Input Cost Index</div>
          <div className="tabular-nums font-semibold" style={{ color: sc.input_cost_index > 1 ? '#dc2626' : '#16a34a' }}>
            {sc.input_cost_index.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-tertiary)]">Gross Availability</div>
          <div className="tabular-nums font-semibold">{sc.gross_availability_pct.toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-tertiary)]">LFL Revision</div>
          <div className="tabular-nums font-semibold" style={{ color: sc.lfl_revision_pct < 0 ? '#dc2626' : '#16a34a' }}>
            {sc.lfl_revision_pct >= 0 ? '+' : ''}{sc.lfl_revision_pct.toFixed(2)}pp
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {sc.active_events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-lg border border-[var(--color-border-secondary)] p-2">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOUR[e.severity] ?? '#6b7280' }} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{e.description}</span>
                <Pill label={e.severity} colour={SEVERITY_COLOUR[e.severity] ?? '#6b7280'} />
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                cost +{e.cost_impact_pct.toFixed(1)}% · availability −{e.availability_impact_pct.toFixed(1)}% · {e.affected_suppliers.join(', ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Traffic ───────────────────────────────────────────────────────────────────

function TrafficCard({ traffic }: { traffic: Traffic }) {
  const [tab, setTab] = useState<'state' | 'archetype'>('state')
  const rows = tab === 'state' ? traffic.state_breakdown : traffic.archetype_breakdown
  return (
    <Card>
      <SectionHeader title="Location Foot Traffic" sub={`IV-adjusted LFL signal · ${traffic.state_breakdown.reduce((a, b) => a + b.locations, 0)} modelled stores`} />
      <div className="mb-2 flex gap-1 text-xs">
        {(['state', 'archetype'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-2 py-1 font-medium transition ${tab === t ? 'bg-[var(--color-text-primary)] text-[var(--color-background-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--color-text-tertiary)]">
              <th className="pb-1 text-left font-medium">{tab === 'state' ? 'State' : 'Archetype'}</th>
              <th className="pb-1 text-right font-medium tabular-nums">Stores</th>
              <th className="pb-1 text-right font-medium tabular-nums">Wkly Txns</th>
              <th className="pb-1 text-right font-medium tabular-nums">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={'state' in r ? r.state : r.archetype} className="border-t border-[var(--color-border-tertiary)]">
                <td className="py-1 text-[var(--color-text-primary)]">{'state' in r ? r.state : r.archetype}</td>
                <td className="py-1 text-right tabular-nums text-[var(--color-text-secondary)]">{r.locations}</td>
                <td className="py-1 text-right tabular-nums text-[var(--color-text-secondary)]">{r.transactions.toLocaleString()}</td>
                <td className="py-1 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                  {r.revenue.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── News Feed ─────────────────────────────────────────────────────────────────

function NewsCard({ news }: { news: News }) {
  return (
    <Card>
      <SectionHeader title="News Catalysts" sub={`${news.catalyst_count} events · net materiality ${news.net_materiality_score > 0 ? '+' : ''}${(news.net_materiality_score * 100).toFixed(1)}%`} />
      <div className="space-y-2">
        {news.enriched_events.slice(0, 6).map((e, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--color-border-secondary)] p-2">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SENTIMENT_COLOUR[e.sentiment] }} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-1">
                <span className="text-xs font-medium text-[var(--color-text-primary)] leading-tight">{e.headline}</span>
                <span className="shrink-0 tabular-nums text-[11px] font-semibold" style={{ color: SENTIMENT_COLOUR[e.sentiment] }}>
                  {(e.materiality_score * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-[var(--color-text-tertiary)]">
                <span>{e.catalyst_type}</span>
                <span>·</span>
                <span>{e.academic_class}</span>
                <span>·</span>
                <span>{e.date}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Causal Governance ─────────────────────────────────────────────────────────

function CausalCard({ causal, kg }: { causal: Causal; kg: KG }) {
  return (
    <Card>
      <SectionHeader title="Causal Governance" sub={`${causal.dag_count} DAGs · IV F-stat ${causal.iv_first_stage_f}`} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {causal.dag_names.map((n) => (
          <span key={n} className="rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-tertiary)] px-2 py-0.5 text-[11px] font-mono text-[var(--color-text-secondary)]">
            {n}
          </span>
        ))}
      </div>
      <div className="mb-3 space-y-1">
        {causal.identification_strategies.map((s, i) => (
          <p key={i} className="text-xs text-[var(--color-text-secondary)]">• {s}</p>
        ))}
      </div>
      <div className="mt-3 border-t border-[var(--color-border-tertiary)] pt-3">
        <div className="mb-2 text-xs font-medium text-[var(--color-text-tertiary)]">KKO Ontology</div>
        <div className="space-y-1">
          {kg.kko_entities.slice(0, 4).map((e) => (
            <div key={e.label} className="flex gap-2 text-xs">
              <span className="shrink-0 font-mono text-[10px] text-blue-600">{e.kko_class}</span>
              <span className="text-[var(--color-text-primary)]">{e.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {kg.semantic_dimensions.map((d) => (
            <span key={d} className="rounded bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">{d}</span>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ── Main surface ──────────────────────────────────────────────────────────────

export function PortfolioSurface() {
  const [lens, setLens] = useState<Lens | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setErr('')
    void fetch(amUrl('/api/portfolio/lens'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { lens: Lens }) => setLens(d.lens))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed — is the backend running?'))
  }, [])

  useEffect(load, [load])

  if (err) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{err}</p>
          <button onClick={load} className="rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-background-primary)]">Retry</button>
        </div>
      </div>
    )
  }

  if (!lens) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-[var(--color-text-tertiary)]">Loading portfolio lens…</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--color-text-primary)]">{lens.ticker.ticker}</span>
              <span className="text-sm text-[var(--color-text-secondary)]">{lens.ticker.name}</span>
              <Pill label={lens.ticker.exchange} colour="#2563eb" />
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">{lens.ticker.sector} · A${lens.ticker.market_cap_aud_bn}B market cap · {lens.ticker.store_count} stores</p>
          </div>
          <button onClick={load} className="shrink-0 rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
            Refresh
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">{lens.pm_narrative}</p>
      </div>

      {/* Body */}
      <div className="flex-1 px-6 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Column 1 */}
          <div className="space-y-4">
            <SignalCard signal={lens.signal} />
            <ComponentsCard components={lens.signal_components} />
            <LFLChart historical={lens.historical_lfl} forecast={lens.forecast} />
          </div>
          {/* Column 2 */}
          <div className="space-y-4">
            <SupplyChainCard sc={lens.supply_chain} />
            <TrafficCard traffic={lens.traffic} />
            <NewsCard news={lens.news} />
            <CausalCard causal={lens.causal} kg={lens.kg} />
          </div>
        </div>
      </div>
    </div>
  )
}

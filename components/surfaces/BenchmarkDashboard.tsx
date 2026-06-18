'use client'

import { useEffect, useMemo, useState } from 'react'
import { readLedgerEntries, type LedgerEntry } from '@/lib/evidence/ledger-store'
import { amUrl } from '@/lib/tauri/bridge'
import { isLocalProvider } from '@/lib/pricing/modelPricing'

// ─── Types ────────────────────────────────────────────────────────────────────

type ModelAgg = {
  model: string
  provider: string
  isLocal: boolean
  runs: number
  avgLatencyMs: number
  avgQuality: number | null
  totalCostUsd: number
  totalEgressed: number
}

type LiveSummaryRow = {
  model: string
  provider: string
  is_local: boolean
  runs: number
  error_rate: number
  avg_latency_ms: number
  total_cost_usd: number
  avg_cost_usd: number
  total_tokens_egressed: number
}

type GraphSubstrate = {
  nodeCount: number
  edgeCount: number
  beliefs: number
  laws: number
}

type FrontierRow = { name: string; metric: string; value: number | string }

// ─── Aggregation ────────────────────────────────────────────────────────────────

function aggregateBenchmarks(entries: LedgerEntry[]): ModelAgg[] {
  const benchmarks = entries.filter((e) => e.kind === 'benchmark_result')
  const byModel = new Map<string, { e: LedgerEntry[]; }>()
  for (const e of benchmarks) {
    const key = `${e.provider}:${e.model_id}`
    if (!byModel.has(key)) byModel.set(key, { e: [] })
    byModel.get(key)!.e.push(e)
  }
  const out: ModelAgg[] = []
  for (const { e } of byModel.values()) {
    const first = e[0]!
    const scored = e.filter((x) => typeof x.judge_score === 'number')
    out.push({
      model: first.model_id,
      provider: first.provider,
      isLocal: isLocalProvider(first.provider),
      runs: e.length,
      avgLatencyMs: Math.round(e.reduce((s, x) => s + (x.latency_ms ?? 0), 0) / e.length),
      avgQuality: scored.length
        ? scored.reduce((s, x) => s + (x.judge_score ?? 0), 0) / scored.length
        : null,
      totalCostUsd: e.reduce((s, x) => s + (x.cost_usd ?? 0), 0),
      totalEgressed: e.reduce((s, x) => s + (x.tokens_egressed ?? 0), 0),
    })
  }
  return out.sort((a, b) => b.runs - a.runs)
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function BenchmarkDashboard() {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [live, setLive] = useState<LiveSummaryRow[]>([])
  const [substrate, setSubstrate] = useState<GraphSubstrate | null>(null)
  const [frontier, setFrontier] = useState<FrontierRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const led = await readLedgerEntries(2000).catch(() => [])
      if (!cancelled) setEntries(led)

      // Live chat-run aggregates (best-effort — agent-machine may be down)
      fetch(amUrl('/api/benchmark/summary'), { signal: AbortSignal.timeout(3000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { summary?: LiveSummaryRow[] } | null) => { if (!cancelled && d?.summary) setLive(d.summary) })
        .catch(() => { /* offline — ledger still drives the dashboard */ })

      // Memory substrate (the compounding-advantage story)
      Promise.allSettled([
        fetch(amUrl('/api/graph/health'), { signal: AbortSignal.timeout(3000) }).then((r) => r.json()),
        fetch(amUrl('/api/gaia/beliefs?limit=100'), { signal: AbortSignal.timeout(3000) }).then((r) => r.json()),
        fetch(amUrl('/api/gaia/laws?limit=100'), { signal: AbortSignal.timeout(3000) }).then((r) => r.json()),
      ]).then(([h, b, l]) => {
        if (cancelled) return
        const graph = h.status === 'fulfilled' ? h.value?.graph : undefined
        const beliefs = b.status === 'fulfilled' ? (b.value?.beliefs?.length ?? b.value?.snapshots?.length ?? 0) : 0
        const laws = l.status === 'fulfilled' ? (l.value?.laws?.length ?? 0) : 0
        if (graph) setSubstrate({ nodeCount: graph.nodeCount ?? 0, edgeCount: graph.edgeCount ?? 0, beliefs, laws })
      }).catch(() => { /* best-effort */ })

      // Optional EvalFabric frontier connector — only if configured + reachable
      const efBase = process.env['NEXT_PUBLIC_EVALFABRIC_URL']
      if (efBase) {
        fetch(`${efBase.replace(/\/$/, '')}/v1/competition/radar`, { signal: AbortSignal.timeout(3000) })
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { radar?: FrontierRow[]; axes?: FrontierRow[] } | null) => {
            const rows = d?.radar ?? d?.axes
            if (!cancelled && rows?.length) setFrontier(rows)
          })
          .catch(() => { /* EvalFabric not reachable — section stays hidden */ })
      }

      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const aggs = useMemo(() => aggregateBenchmarks(entries), [entries])

  // Sovereignty totals
  const cloudCost = aggs.reduce((s, a) => s + a.totalCostUsd, 0)
    + live.filter((l) => !l.is_local).reduce((s, l) => s + l.total_cost_usd, 0)
  const cloudEgress = aggs.reduce((s, a) => s + a.totalEgressed, 0)
    + live.filter((l) => !l.is_local).reduce((s, l) => s + l.total_tokens_egressed, 0)
  const localRuns = aggs.filter((a) => a.isLocal).reduce((s, a) => s + a.runs, 0)
    + live.filter((l) => l.is_local).reduce((s, l) => s + l.runs, 0)

  const hasData = aggs.length > 0 || live.length > 0

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-5 text-sm text-[var(--color-text-primary)]">
      <div>
        <h2 className="text-base font-semibold">Local vs Frontier</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
          Where local-first Noetica wins: cost, sovereignty, and a knowledge substrate that compounds across sessions — cloud models start cold every time.
        </p>
      </div>

      {/* Sovereignty / cost cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Local runs" value={localRuns.toLocaleString()} accent="green" sub="on-device, $0 marginal" />
        <StatCard label="Local cost" value="$0.00" accent="green" sub="runs on your hardware" />
        <StatCard label="Cloud cost (est.)" value={`$${cloudCost.toFixed(4)}`} accent={cloudCost > 0 ? 'amber' : 'neutral'} sub="what cloud would bill" />
        <StatCard label="Tokens egressed" value={cloudEgress > 0 ? cloudEgress.toLocaleString() : '0'} accent={cloudEgress > 0 ? 'amber' : 'green'} sub="left the device (cloud only)" />
      </div>

      {!hasData && !loading && (
        <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4 text-xs text-[var(--color-text-tertiary)]">
          No benchmark data yet. Run a comparison in the <span className="font-medium text-[var(--color-text-secondary)]">Run</span> tab — results persist here across sessions.
        </div>
      )}

      {/* Quality vs Cost Pareto */}
      {aggs.some((a) => a.avgQuality !== null) && (
        <Section title="Quality vs cost" hint="Top-left is best: high quality, low cost. Local models (green) sit on the zero-cost axis.">
          <ParetoChart aggs={aggs.filter((a) => a.avgQuality !== null)} />
        </Section>
      )}

      {/* Benchmark comparison table */}
      {aggs.length > 0 && (
        <Section title="Benchmark results" hint="From Evaluate runs (LLM-as-judge quality where enabled).">
          <CompareTable
            rows={aggs.map((a) => ({
              model: a.model, isLocal: a.isLocal, runs: a.runs,
              latency: a.avgLatencyMs, quality: a.avgQuality, cost: a.totalCostUsd, egress: a.totalEgressed,
            }))}
          />
        </Section>
      )}

      {/* Live chat-run aggregates */}
      {live.length > 0 && (
        <Section title="Live chat runs" hint="Aggregated from the governance ring (latency / cost / egress; no quality score).">
          <CompareTable
            rows={live.map((l) => ({
              model: l.model, isLocal: l.is_local, runs: l.runs,
              latency: l.avg_latency_ms, quality: null, cost: l.total_cost_usd, egress: l.total_tokens_egressed,
            }))}
          />
        </Section>
      )}

      {/* Memory substrate — the compounding advantage */}
      {substrate && (
        <Section title="Knowledge substrate (compounding)" hint="Persists across every session. A cloud chat starts from zero each time.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Graph atoms" value={substrate.nodeCount.toLocaleString()} accent="green" sub="entities + interactions" />
            <StatCard label="Relations" value={substrate.edgeCount.toLocaleString()} accent="green" sub="learned co-occurrences" />
            <StatCard label="Beliefs" value={substrate.beliefs.toLocaleString()} accent="green" sub="world-model snapshots" />
            <StatCard label="Candidate laws" value={substrate.laws.toLocaleString()} accent="green" sub="discovered regularities" />
          </div>
        </Section>
      )}

      {/* Optional EvalFabric frontier radar */}
      {frontier && frontier.length > 0 && (
        <Section title="Frontier radar (EvalFabric)" hint="Live from the Prophet Platform eval lane.">
          <div className="overflow-hidden rounded-xl border border-[var(--color-border-tertiary)]">
            <table className="w-full text-xs">
              <tbody>
                {frontier.map((f, i) => (
                  <tr key={i} className="border-b border-[var(--color-border-tertiary)] last:border-0">
                    <td className="px-3 py-2 font-medium">{f.name}</td>
                    <td className="px-3 py-2 text-[var(--color-text-tertiary)]">{f.metric}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{String(f.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: 'green' | 'amber' | 'neutral' }) {
  const ring =
    accent === 'green' ? 'border-[#86efac]' : accent === 'amber' ? 'border-[#fde68a]' : 'border-[var(--color-border-tertiary)]'
  const dot =
    accent === 'green' ? 'bg-[#16a34a]' : accent === 'amber' ? 'bg-[#d97706]' : 'bg-[var(--color-text-tertiary)]'
  return (
    <div className={`rounded-xl border ${ring} bg-[var(--color-background-secondary)] p-3`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-text-tertiary)]">{sub}</div>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-[11px] text-[var(--color-text-tertiary)]">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

type Row = { model: string; isLocal: boolean; runs: number; latency: number; quality: number | null; cost: number; egress: number }

function CompareTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border-tertiary)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border-tertiary)] text-left text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 font-medium">Runs</th>
            <th className="px-3 py-2 font-medium">Avg latency</th>
            <th className="px-3 py-2 font-medium">Avg quality</th>
            <th className="px-3 py-2 font-medium">Cost</th>
            <th className="px-3 py-2 font-medium">Egressed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--color-border-tertiary)] last:border-0">
              <td className="px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${r.isLocal ? 'bg-[#16a34a]' : 'bg-[#d97706]'}`} />
                  <span className="font-medium">{r.model}</span>
                  <span className="text-[9px] uppercase text-[var(--color-text-tertiary)]">{r.isLocal ? 'local' : 'cloud'}</span>
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums">{r.runs}</td>
              <td className="px-3 py-2 tabular-nums">{(r.latency / 1000).toFixed(1)}s</td>
              <td className="px-3 py-2 tabular-nums">{r.quality !== null ? `${(r.quality * 100).toFixed(0)}%` : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{r.isLocal ? '$0.00' : `$${r.cost.toFixed(4)}`}</td>
              <td className="px-3 py-2 tabular-nums">{r.egress > 0 ? r.egress.toLocaleString() : '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ParetoChart({ aggs }: { aggs: ModelAgg[] }) {
  const W = 460, H = 240, pad = 36
  const maxCost = Math.max(...aggs.map((a) => a.totalCostUsd), 0.0001)
  const x = (cost: number) => pad + (cost / maxCost) * (W - pad * 2)
  const y = (q: number) => H - pad - q * (H - pad * 2) // q in 0..1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[480px]" role="img" aria-label="Quality vs cost scatter">
      {/* axes */}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--color-border-secondary)" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--color-border-secondary)" strokeWidth="1" />
      <text x={W - pad} y={H - pad + 14} textAnchor="end" fontSize="9" fill="var(--color-text-tertiary)">cost →</text>
      <text x={pad - 6} y={pad} textAnchor="end" fontSize="9" fill="var(--color-text-tertiary)">quality</text>
      {/* "best" corner hint */}
      <text x={pad + 4} y={pad + 10} fontSize="9" fill="#16a34a">◤ best</text>
      {aggs.map((a, i) => {
        const cx = x(a.totalCostUsd), cy = y(a.avgQuality ?? 0)
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r="5" fill={a.isLocal ? '#16a34a' : '#d97706'} fillOpacity="0.85" />
            <text x={cx + 8} y={cy + 3} fontSize="8" fill="var(--color-text-secondary)">{a.model}</text>
          </g>
        )
      })}
    </svg>
  )
}

'use client'

import { useEffect, useState } from 'react'

interface GraphHealth {
  status: 'healthy' | 'degraded' | 'unknown'
  nodeCount: number
  edgeCount: number
  pendingIngestCount: number
  failedIngestCount: number
  orphanNodeCount: number
  vectorIndexStatus: string
}

interface HealthResponse {
  graph: GraphHealth
}

export function GraphRailPanel() {
  const [health, setHealth] = useState<GraphHealth | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch('/api/graph/health')
        if (!res.ok) throw new Error('non-ok')
        const json = (await res.json()) as HealthResponse
        if (!cancelled) { setHealth(json.graph); setError(false) }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    void poll()
    const id = setInterval(() => void poll(), 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const fmt = (n: number | undefined) => n !== undefined ? n.toLocaleString() : '—'

  const statusColor = health?.status === 'healthy'
    ? '#16a34a'
    : health?.status === 'degraded'
    ? '#d97706'
    : '#6b7280'

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Sociosphere Graph</div>
          {health && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium" style={{ color: statusColor }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              {health.status}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Graph health at a glance</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Nodes',   fmt(health?.nodeCount)],
            ['Edges',   fmt(health?.edgeCount)],
            ['Pending', fmt(health?.pendingIngestCount)],
            ['Failed',  fmt(health?.failedIngestCount)],
            ['Orphans', fmt(health?.orphanNodeCount)],
            ['Vector',  health?.vectorIndexStatus ?? '—'],
          ].map(([label, val]) => (
            <div key={label} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 text-center">
              <div className="text-base font-bold text-[var(--color-text-primary)]">{val}</div>
              <div className="text-[10px] text-[var(--color-text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
        {error && (
          <div className="rounded-xl border border-dashed border-[#fca5a5] bg-[#fef2f2] px-3 py-3 text-center text-xs text-[#dc2626]">
            Graph endpoint unreachable. Is the HellGraph running?
          </div>
        )}
        {!error && health && health.nodeCount === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
            Graph is empty — ingest some data to get started.
          </div>
        )}
        <button className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
          Open graph explorer
        </button>
      </div>
    </div>
  )
}

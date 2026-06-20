'use client'

import { useEffect, useState } from 'react'
import { SurfaceGraph, type GraphNode, type GraphLink } from '@/components/graph/SurfaceGraph'

interface GraphHealth {
  status: 'healthy' | 'degraded' | 'unknown'
  nodeCount: number
  edgeCount: number
  pendingIngestCount: number
  failedIngestCount: number
  orphanNodeCount: number
  vectorIndexStatus: string
}

interface HealthResponse { graph: GraphHealth }

const VIEWS = [
  { key: 'document', label: 'Docs' },
  { key: 'domain', label: 'Domain' },
  { key: 'chat', label: 'Chat' },
  { key: 'all', label: 'All' },
] as const

export function GraphRailPanel() {
  const [health, setHealth] = useState<GraphHealth | null>(null)
  const [error, setError] = useState(false)
  const [view, setView] = useState<string>('document')
  const [root, setRoot] = useState<string>('')
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })

  // health poll
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/graph/health')
        if (!res.ok) throw new Error('non-ok')
        const json = (await res.json()) as HealthResponse
        if (!cancelled) { setHealth(json.graph); setError(false) }
      } catch { if (!cancelled) setError(true) }
    }
    void poll()
    const id = setInterval(() => void poll(), 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // graph load — re-runs when the lens or focused root changes
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const q = `/api/graph/surface?view=${view}&limit=24${root ? `&root=${encodeURIComponent(root)}` : ''}`
        const res = await fetch(q)
        if (!res.ok) return
        const json = (await res.json()) as { nodes: GraphNode[]; links: GraphLink[] }
        if (!cancelled) setGraph({ nodes: json.nodes ?? [], links: json.links ?? [] })
      } catch { /* leave */ }
    }
    void load()
    return () => { cancelled = true }
  }, [view, root])

  const fmt = (n: number | undefined) => (n !== undefined ? n.toLocaleString() : '—')
  const statusColor = health?.status === 'healthy' ? '#16a34a' : health?.status === 'degraded' ? '#d97706' : '#6b7280'
  const focusLabel = root ? graph.nodes.find((n) => n.id === root)?.label : ''

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
        {/* lens switcher: scope the graph by document / domain / chat / all */}
        <div className="mt-2 flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => { setView(v.key); setRoot('') }}
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold transition"
              style={{
                border: '1px solid ' + (view === v.key ? '#1d4ed8' : 'var(--color-border-secondary)'),
                background: view === v.key ? '#1d4ed8' : 'transparent',
                color: view === v.key ? '#fff' : 'var(--color-text-secondary)',
              }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {graph.nodes.length > 0 ? (
          <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-1">
            <SurfaceGraph nodes={graph.nodes} links={graph.links} width={360} height={300} onNodeClick={setRoot} />
            {root && (
              <div className="flex items-center justify-between px-2 pb-1 text-[10px] text-[var(--color-text-secondary)]">
                <span className="truncate">focused: <b>{focusLabel || root.split(':').pop()}</b></span>
                <button onClick={() => setRoot('')} className="font-semibold text-[#1d4ed8]">clear</button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-6 text-center text-[11px] text-[var(--color-text-tertiary)]">
            No atoms for this lens yet — try another view.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {[
            ['Nodes', fmt(health?.nodeCount)],
            ['Edges', fmt(health?.edgeCount)],
            ['Pending', fmt(health?.pendingIngestCount)],
            ['Failed', fmt(health?.failedIngestCount)],
            ['Orphans', fmt(health?.orphanNodeCount)],
            ['Vector', health?.vectorIndexStatus ?? '—'],
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
      </div>
    </div>
  )
}

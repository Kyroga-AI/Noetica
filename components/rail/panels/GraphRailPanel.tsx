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
  { key: 'tech', label: 'Tech' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'document', label: 'Memory' },
  { key: 'all', label: 'All' },
] as const

export function GraphRailPanel() {
  const [health, setHealth] = useState<GraphHealth | null>(null)
  const [error, setError] = useState(false)
  const [view, setView] = useState<string>('tech')
  const [root, setRoot] = useState<string>('')
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [expanded, setExpanded] = useState(false)

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
        // 22 top-level topics; clicking one drills into its subtopics (a wider BFS).
        const q = `/api/graph/surface?view=${view}&limit=${root ? 28 : 22}${root ? `&root=${encodeURIComponent(root)}` : ''}`
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

  const lensButtons = (
    <div className="flex flex-wrap gap-1">
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
  )

  return (
    <>
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Sociosphere Graph</div>
          <div className="flex items-center gap-2.5">
            {health && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium" style={{ color: statusColor }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                {health.status}
              </span>
            )}
            <button onClick={() => setExpanded(true)} title="Expand graph" aria-label="Expand graph"
              className="text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>
        {/* lens switcher: scope the graph by tech / knowledge / memory / all */}
        <div className="mt-2">{lensButtons}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {graph.nodes.length > 0 ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            <SurfaceGraph nodes={graph.nodes} links={graph.links} fill onNodeClick={setRoot} />
            {root && (
              <div className="absolute inset-x-2 bottom-1 flex items-center justify-between rounded-md bg-[var(--color-background-primary)]/80 px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] backdrop-blur">
                <span className="truncate">focused: <b>{focusLabel || root.split(':').pop()}</b></span>
                <button onClick={() => setRoot('')} className="font-semibold text-[#1d4ed8]">clear</button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 text-center text-[11px] text-[var(--color-text-tertiary)]">
            No nodes for this lens yet — try another view.
          </div>
        )}

        <div className="grid shrink-0 grid-cols-3 gap-1.5">
          {[
            ['Nodes', fmt(health?.nodeCount)],
            ['Edges', fmt(health?.edgeCount)],
            ['Orphans', fmt(health?.orphanNodeCount)],
          ].map(([label, val]) => (
            <div key={label} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-1 py-1.5 text-center">
              <div className="text-sm font-bold text-[var(--color-text-primary)]">{val}</div>
              <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
        {error && (
          <div className="shrink-0 rounded-lg border border-dashed border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-center text-[11px] text-[#dc2626]">
            Graph endpoint unreachable. Is the HellGraph running?
          </div>
        )}
      </div>
    </div>

    {/* Expanded full-window view — the rail is fixed-width, so this is how you actually
        see the graph big. Click the backdrop or ✕ to close. */}
    {expanded && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 sm:p-8" onClick={() => setExpanded(false)}>
        <div className="relative flex h-[90vh] w-[92vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border-secondary)] px-4 py-2.5">
            <div className="flex items-center gap-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Sociosphere Graph</div>
              {lensButtons}
            </div>
            <div className="flex items-center gap-3">
              {root && <button onClick={() => setRoot('')} className="text-[11px] font-semibold text-[#1d4ed8]">← back to topics</button>}
              <button onClick={() => setExpanded(false)} aria-label="Close" className="text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 bg-[var(--color-background-secondary)]">
            {graph.nodes.length > 0 ? (
              <SurfaceGraph nodes={graph.nodes} links={graph.links} fill onNodeClick={setRoot} />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">No nodes for this lens yet.</div>
            )}
            {root && (
              <div className="absolute bottom-3 left-3 rounded-md bg-[var(--color-background-primary)]/85 px-3 py-1 text-[11px] text-[var(--color-text-secondary)] backdrop-blur">
                focused: <b>{focusLabel || root.split(':').pop()}</b> · click a node to drill deeper
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { SurfaceGraph, KIND_COLOR, KIND_ORDER, DIM_COLOR, DIM_ORDER, type GraphNode, type GraphLink, type GraphLayout } from '@/components/graph/SurfaceGraph'

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
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<Array<{ id: string; label: string; surface: string; score: number; via: string }>>([])
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set())
  const [hideInferred, setHideInferred] = useState(false)
  const [layout, setLayout] = useState<GraphLayout>('force')
  const [pathMode, setPathMode] = useState(false)
  const [pathFrom, setPathFrom] = useState('')
  const [pathIds, setPathIds] = useState<string[]>([])

  async function handleNodeClick(id: string) {
    if (!pathMode) { setRoot(id); return }
    if (!pathFrom) { setPathFrom(id); return }   // first pick = source
    try {
      const r = await fetch(`/api/graph/path?from=${encodeURIComponent(pathFrom)}&to=${encodeURIComponent(id)}`)
      const j = (await r.json()) as { path?: { id: string }[] }
      setPathIds((j.path ?? []).map((p) => p.id))
    } catch { /* offline */ }
    setPathFrom(''); setPathMode(false)
  }

  // Esc closes the expanded graph overlay (when drilled into a node, first Esc backs
  // out to topics, second closes) — matches the ← back / ✕ affordances.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (root) setRoot('')
      else setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, root])

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

  // graph search — cosine + Jaccard + link expansion (debounced)
  useEffect(() => {
    const q = searchQ.trim()
    if (q.length < 2) { setSearchHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/graph/search?q=${encodeURIComponent(q)}&limit=8`)
        if (!res.ok) return
        const json = (await res.json()) as { hits?: typeof searchHits }
        if (!cancelled) setSearchHits(json.hits ?? [])
      } catch { /* leave */ }
    }, 220)
    return () => { cancelled = true; clearTimeout(t) }
  }, [searchQ])

  // Memory curation: which graph nodes are memories + their pinned state (for the node-detail
  // pin button → POST /api/memory/pin → LTI boost = "inject into the long-term brain").
  const [memMap, setMemMap] = useState<Record<string, { pinned: boolean; kind: string; preview: string }>>({})
  const loadMemories = async () => {
    try {
      const res = await fetch('/api/memory/graph'); if (!res.ok) return
      const j = (await res.json()) as { memories?: Array<{ id: string; pinned: boolean; kind: string; preview: string }> }
      const m: Record<string, { pinned: boolean; kind: string; preview: string }> = {}
      for (const x of j.memories ?? []) m[x.id] = { pinned: x.pinned, kind: x.kind, preview: x.preview }
      setMemMap(m)
    } catch { /* offline */ }
  }
  useEffect(() => { void loadMemories() }, [])
  const togglePin = async (id: string, pinned: boolean) => {
    setMemMap((cur) => ({ ...cur, [id]: { ...(cur[id] ?? { kind: 'memory', preview: '' }), pinned } }))  // optimistic
    try { await fetch('/api/memory/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, pinned }) }) } catch { /* */ }
    void loadMemories()
  }

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

  // Search box: cosine + Jaccard + link expansion; click a hit to focus the graph on it.
  const searchBox = (
    <div className="relative">
      <input
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQ(''); setSearchHits([]) } }}
        placeholder="Search topics & instances…"
        className="w-full rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#1d4ed8]"
      />
      {searchHits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-lg">
          {searchHits.map((h) => (
            <button key={h.id} onClick={() => { setView('all'); setRoot(h.id); setSearchQ(''); setSearchHits([]); setExpanded(true) }}
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition hover:bg-[var(--color-background-secondary)]">
              <span className="truncate text-[11px] text-[var(--color-text-primary)]">{h.surface}</span>
              <span className="shrink-0 rounded-full px-1.5 text-[9px] font-semibold"
                style={{ background: h.via === 'link' ? '#7c3aed22' : h.via === 'cosine' ? '#1d4ed822' : '#16a34a22',
                         color: h.via === 'link' ? '#7c3aed' : h.via === 'cosine' ? '#1d4ed8' : '#16a34a' }}>
                {h.via}
              </span>
            </button>
          ))}
        </div>
      )}
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
        <div className="mt-2">{searchBox}</div>
        <div className="mt-2">{lensButtons}</div>
        {/* Layout (force / radial / hierarchical) + shortest-path finder. */}
        <div className="mt-2 flex items-center gap-1 text-[10px]">
          <span className="text-[var(--color-text-tertiary)]">layout</span>
          {(['force', 'radial', 'hierarchy'] as GraphLayout[]).map((L) => (
            <button key={L} onClick={() => setLayout(L)}
              className={`rounded-full border px-2 py-0.5 capitalize transition ${layout === L ? 'border-[#1d4ed8] text-[#1d4ed8]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>{L}</button>
          ))}
          <button onClick={() => { setPathMode((v) => !v); setPathFrom(''); if (pathMode) setPathIds([]) }} title="Pick two nodes to find the shortest path between them"
            className={`ml-auto rounded-full border px-2 py-0.5 transition ${pathMode ? 'border-[#f59e0b] text-[#f59e0b]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>
            {pathMode ? (pathFrom ? 'pick target…' : 'pick source…') : '🔗 path'}
          </button>
          {pathIds.length > 0 && <button onClick={() => setPathIds([])} className="text-[#f59e0b]">clear</button>}
        </div>
        {/* Entity-class legend + filter, and a trust toggle. Click a class to hide it; "confirmed
            only" hides inferred (dashed) edges so you see what the graph KNOWS vs guesses. */}
        {(() => {
          const present = KIND_ORDER.filter((k) => graph.nodes.some((n) => (n.kind ?? 'Concept') === k))
          if (present.length === 0) return null
          const count = (k: string) => graph.nodes.filter((n) => (n.kind ?? 'Concept') === k).length
          return (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {present.map((k) => {
                const off = hiddenKinds.has(k)
                return (
                  <button key={k} title={`${count(k)} ${k}`}
                    onClick={() => setHiddenKinds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${off ? 'border-[var(--color-border-tertiary)] text-[var(--color-text-tertiary)] opacity-50' : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]'}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k], opacity: off ? 0.4 : 1 }} />{k}<span className="text-[var(--color-text-tertiary)]">{count(k)}</span>
                  </button>
                )
              })}
              <button onClick={() => setHideInferred((v) => !v)} title="Hide inferred (low-trust, dashed) edges"
                className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] transition ${hideInferred ? 'border-[#16a34a] text-[#16a34a]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>
                {hideInferred ? '✓ confirmed only' : 'confirmed only'}
              </button>
            </div>
          )
        })()}
        {/* Edge-dimension legend (CSKG semantic categories): edges are coloured by relation type. */}
        {(() => {
          const present = DIM_ORDER.filter((d) => graph.links.some((l) => (l.dimension ?? 'functional') === d))
          if (present.length === 0) return null
          return (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">edges</span>
              {present.map((d) => (
                <span key={d} title={`${d} relations`} className="flex items-center gap-1 text-[9px] text-[var(--color-text-tertiary)]">
                  <span className="h-[2px] w-3 rounded" style={{ background: DIM_COLOR[d] }} />{d}
                </span>
              ))}
            </div>
          )
        })()}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {graph.nodes.length > 0 ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            <SurfaceGraph nodes={graph.nodes} links={graph.links} fill onNodeClick={handleNodeClick} layout={layout} pathIds={pathIds}
              visibleKinds={hiddenKinds.size ? new Set(graph.nodes.map((n) => n.kind ?? 'Concept').filter((k) => !hiddenKinds.has(k))) : undefined}
              hideInferred={hideInferred} />
            {root && (() => {
              const fn = graph.nodes.find((n) => n.id === root)
              const mem = memMap[root]
              return (
                <div className="absolute inset-x-2 bottom-1 rounded-md bg-[var(--color-background-primary)]/90 px-2.5 py-1.5 text-[10px] text-[var(--color-text-secondary)] backdrop-blur">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-[var(--color-text-primary)]">{focusLabel || root.split(':').pop()}</span>
                    <button onClick={() => setRoot('')} className="shrink-0 font-semibold text-[#1d4ed8]">clear</button>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--color-text-tertiary)]">
                    {fn?.kind && <span className="rounded bg-[var(--color-background-secondary)] px-1 py-px">{fn.kind}</span>}
                    {fn && <span>{fn.degree} link{fn.degree === 1 ? '' : 's'}</span>}
                  </div>
                  {mem && (
                    <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--color-border-secondary)] pt-1">
                      <span className="truncate text-[9px] text-[var(--color-text-tertiary)]">({mem.kind}) {mem.preview}</span>
                      <button onClick={() => void togglePin(root, !mem.pinned)}
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold transition ${mem.pinned ? 'bg-[#7c3aed] text-white' : 'border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:border-[#7c3aed] hover:text-[#7c3aed]'}`}>
                        {mem.pinned ? '📌 Pinned' : 'Pin to brain'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
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
              <SurfaceGraph nodes={graph.nodes} links={graph.links} fill onNodeClick={handleNodeClick} layout={layout} pathIds={pathIds}
              visibleKinds={hiddenKinds.size ? new Set(graph.nodes.map((n) => n.kind ?? 'Concept').filter((k) => !hiddenKinds.has(k))) : undefined}
              hideInferred={hideInferred} />
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

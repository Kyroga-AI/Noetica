'use client'

import { useCallback, useEffect, useState } from 'react'
import { SurfaceGraph, KIND_COLOR, KIND_ORDER, type GraphNode, type GraphLink, type GraphLayout } from '@/components/graph/SurfaceGraph'

/**
 * Data → Knowledge Graph — the full-screen center graph, backed by the live HellGraph
 * (local-first, on-device + as-a-service). Reuses the SurfaceGraph viz and the existing
 * /api/graph/surface + /api/graph/health endpoints, at full center width (not the cramped
 * rail). Click a node to drill in; search re-roots the view.
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

const VIEWS = ['tech', 'trust', 'learning', 'docs'] as const

export function KnowledgeGraphSurface() {
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [view, setView] = useState<(typeof VIEWS)[number]>('tech')
  const [root, setRoot] = useState('')
  const [rootInput, setRootInput] = useState('')
  const [layout, setLayout] = useState<GraphLayout>('force')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [total, setTotal] = useState<{ nodes?: number; edges?: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const q = `${amBase()}/api/graph/surface?view=${view}&limit=${root ? 80 : 120}${root ? `&root=${encodeURIComponent(root)}` : ''}`
      const res = await fetch(q)
      if (!res.ok) throw new Error(`graph ${res.status}`)
      const json = (await res.json()) as { nodes?: GraphNode[]; links?: GraphLink[] }
      setGraph({ nodes: json.nodes ?? [], links: json.links ?? [] })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load graph — is the agent-machine backend running?')
    } finally {
      setLoading(false)
    }
  }, [view, root])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    // total graph size (best-effort; shape varies)
    fetch(`${amBase()}/api/graph/health`).then((r) => r.ok ? r.json() : null).then((h: Record<string, unknown> | null) => {
      if (!h) return
      const n = (h.nodes ?? h.nodeCount ?? h.totalNodes) as number | undefined
      const e = (h.edges ?? h.edgeCount ?? h.totalEdges) as number | undefined
      if (typeof n === 'number' || typeof e === 'number') setTotal({ nodes: typeof n === 'number' ? n : undefined, edges: typeof e === 'number' ? e : undefined })
    }).catch(() => { /* non-fatal */ })
  }, [])

  const kindsPresent = KIND_ORDER.filter((k) => graph.nodes.some((n) => (n as { kind?: string }).kind === k))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Knowledge Graph</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#16a34a]"><span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />HellGraph · on-device</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setRoot(rootInput.trim()) }} className="flex items-center gap-1.5">
          <input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Root at node id…"
            className="w-52 rounded-lg border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-2.5 py-1 text-xs outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]" />
          {root && <button type="button" onClick={() => { setRoot(''); setRootInput('') }} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">clear</button>}
        </form>
        <div className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-lg px-2 py-1 text-[10px] font-medium capitalize transition ${view === v ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>{v}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {(['force', 'radial', 'hierarchy'] as GraphLayout[]).map((l) => (
            <button key={l} onClick={() => setLayout(l)}
              className={`rounded-lg px-2 py-1 text-[10px] font-medium capitalize transition ${layout === l ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
          <span>{graph.nodes.length} nodes · {graph.links.length} edges shown{total?.nodes != null ? ` of ${total.nodes}` : ''}</span>
          <button onClick={() => void load()} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">Refresh</button>
        </div>
      </div>

      {/* Legend */}
      {kindsPresent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-1.5">
          {kindsPresent.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-[9px] text-[var(--color-text-secondary)]">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}
            </span>
          ))}
        </div>
      )}

      {/* Graph */}
      <div className="relative min-h-0 flex-1">
        {err ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[#dc2626]">{err}</div>
        ) : graph.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-tertiary)]">{loading ? 'Loading graph…' : 'No nodes in this view. Ingest a repo or documents to populate the graph.'}</div>
        ) : (
          <SurfaceGraph nodes={graph.nodes} links={graph.links} fill layout={layout} colorBy="class" sizeBy="degree"
            onNodeClick={(id: string) => { setRoot(id); setRootInput(id) }} />
        )}
        {loading && graph.nodes.length > 0 && <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">updating…</div>}
      </div>
    </div>
  )
}

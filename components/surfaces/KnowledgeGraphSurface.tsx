'use client'

import { useCallback, useEffect, useState } from 'react'
import { SurfaceGraph, KIND_COLOR, KIND_ORDER, type GraphNode, type GraphLink, type GraphLayout } from '@/components/graph/SurfaceGraph'

/**
 * Data → Knowledge Graph — the full-screen center graph, backed by the live HellGraph
 * (local-first, on-device + as-a-service). Reuses the SurfaceGraph viz and the existing
 * /api/graph/surface + /api/graph/health endpoints, at full center width (not the cramped
 * rail). Click a node to drill in; search re-roots the view.
 *
 * Proposals panel: staged graph-mutation proposals from the agent (add-node, add-edge,
 * remove-edge, update-prop) that the user accepts or rejects per change before any graph
 * write occurs. Backend: /api/graph/proposals (GET/POST/accept/reject).
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

const VIEWS = ['tech', 'trust', 'learning', 'docs'] as const

type ProposalOp = 'add-node' | 'add-edge' | 'remove-edge' | 'update-prop'
interface GraphProposal {
  id: string
  op: ProposalOp
  payload: Record<string, unknown>
  rationale: string
  source?: string
  status: 'pending' | 'accepted' | 'rejected'
}

const OP_LABEL: Record<ProposalOp, string> = {
  'add-node':    '+ node',
  'add-edge':    '+ edge',
  'remove-edge': '- edge',
  'update-prop': '~ prop',
}
const OP_COLOR: Record<ProposalOp, string> = {
  'add-node':    '#16a34a',
  'add-edge':    '#2563eb',
  'remove-edge': '#dc2626',
  'update-prop': '#d97706',
}

function proposalSummary(p: GraphProposal): string {
  const pl = p.payload
  if (p.op === 'add-edge' || p.op === 'remove-edge') {
    const from = typeof pl['from'] === 'string' ? pl['from'] : '?'
    const to   = typeof pl['to']   === 'string' ? pl['to']   : '?'
    const rel  = typeof pl['rel']  === 'string' ? pl['rel']  : ''
    return rel ? `${from} →[${rel}]→ ${to}` : `${from} → ${to}`
  }
  if (p.op === 'add-node') {
    const id   = typeof pl['id']    === 'string' ? pl['id']    : ''
    const kind = typeof pl['kind']  === 'string' ? pl['kind']  : ''
    return kind ? `${kind}: ${id}` : id
  }
  if (p.op === 'update-prop') {
    const node = typeof pl['node']  === 'string' ? pl['node']  : '?'
    const prop = typeof pl['prop']  === 'string' ? pl['prop']  : '?'
    const val  = typeof pl['value'] !== 'undefined' ? String(pl['value']).slice(0, 40) : '?'
    return `${node}.${prop} = ${val}`
  }
  return JSON.stringify(pl).slice(0, 60)
}

export function KnowledgeGraphSurface() {
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [view, setView] = useState<(typeof VIEWS)[number]>('tech')
  const [root, setRoot] = useState('')
  const [rootInput, setRootInput] = useState('')
  const [layout, setLayout] = useState<GraphLayout>('force')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [total, setTotal] = useState<{ nodes?: number; edges?: number } | null>(null)
  const [memBusy, setMemBusy] = useState(false)
  const [memNote, setMemNote] = useState('')

  // Graph proposals state
  const [proposals, setProposals] = useState<GraphProposal[]>([])
  const [proposalsOpen, setProposalsOpen] = useState(false)
  const [proposalBusy, setProposalBusy] = useState<Set<string>>(new Set())
  const pendingCount = proposals.filter((p) => p.status === 'pending').length

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

  const loadProposals = useCallback(async () => {
    try {
      const r = await fetch(`${amBase()}/api/graph/proposals`)
      if (!r.ok) return
      const d = (await r.json()) as { proposals?: GraphProposal[] }
      setProposals(d.proposals ?? [])
    } catch { /* non-fatal */ }
  }, [])

  const actOnProposal = useCallback(async (id: string, action: 'accept' | 'reject') => {
    setProposalBusy((s) => new Set(s).add(id))
    try {
      await fetch(`${amBase()}/api/graph/proposals/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await loadProposals()
      if (action === 'accept') void load()   // refresh graph — new nodes/edges may be visible
    } catch { /* non-fatal */ }
    finally { setProposalBusy((s) => { const n = new Set(s); n.delete(id); return n }) }
  }, [loadProposals, load])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadProposals() }, [loadProposals])

  // Poll proposals every 15 s when panel is open
  useEffect(() => {
    if (!proposalsOpen) return
    const t = setInterval(() => { void loadProposals() }, 15000)
    return () => clearInterval(t)
  }, [proposalsOpen, loadProposals])

  useEffect(() => {
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
      <div className="flex h-[46px] flex-nowrap items-center gap-[10px] overflow-x-auto border-b border-[var(--line)] bg-[var(--color-background-primary)] px-4">
        <span className="text-[13px] font-bold text-[var(--color-text-primary)]">Knowledge Graph</span>
        {(() => {
          const healthy = !err && (graph.nodes.length > 0 || (total?.nodes ?? 0) > 0)
          const pillCls = err
            ? 'bg-[rgba(var(--danger),0.1)] border border-[var(--danger)]'
            : healthy
              ? 'bg-[var(--verified-soft)] border border-[var(--verified-line)]'
              : 'bg-[var(--pending-soft)] border border-[var(--pending-line)]'
          const dotCls = err ? 'bg-[var(--danger)]' : healthy ? 'bg-[var(--verified)]' : 'bg-[var(--pending)]'
          const textCls = err ? 'text-[var(--danger-fg)]' : healthy ? 'text-[var(--verified-fg)]' : 'text-[var(--pending-fg)]'
          const label = err ? 'HellGraph · unreachable' : healthy ? 'HellGraph · on-device · demo' : loading ? 'HellGraph · loading…' : 'HellGraph · no data'
          return (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${pillCls} ${textCls}`} title={err || undefined}>
              <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />{label}
            </span>
          )
        })()}
        <form onSubmit={(e) => { e.preventDefault(); setRoot(rootInput.trim()) }} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Root at node id…"
            className="w-[140px] rounded-[8px] border border-[var(--line)] bg-[var(--color-background-secondary)] px-[9px] py-[5px] text-[11.5px] outline-none focus:border-[var(--accent)] focus:bg-[var(--color-background-primary)]"
            style={{ fontFamily: 'Manrope' }} />
          {root && <button type="button" onClick={() => { setRoot(''); setRootInput('') }} className="rounded-[7px] border border-[var(--line)] px-2 py-1 text-[10.5px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">clear</button>}
        </form>
        <div className="flex shrink-0" style={{ gap: '2px' }}>
          {VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-[7px] px-[10px] py-[4px] text-[11px] capitalize ${view === v ? 'border border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]' : 'font-medium text-[var(--color-text-secondary)]'}`}>{v}</button>
          ))}
        </div>
        <div className="flex shrink-0" style={{ gap: '2px' }}>
          {(['force', 'radial', 'hierarchy'] as GraphLayout[]).map((l) => (
            <button key={l} onClick={() => setLayout(l)}
              className={`rounded-[7px] px-[10px] py-[4px] text-[11px] capitalize ${layout === l ? 'bg-[var(--color-background-tertiary)] font-bold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)]'}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="whitespace-nowrap text-[10px] text-[var(--color-text-tertiary)]">{graph.nodes.length} nodes · {graph.links.length} edges shown{total?.nodes != null ? ` of ${total.nodes}` : ''}</span>
        {/* Proposals button */}
        <button
          onClick={() => { setProposalsOpen((v) => !v); if (!proposalsOpen) void loadProposals() }}
          className={`rounded-[7px] border px-[10px] py-[4px] text-[11px] ${proposalsOpen ? 'border-[var(--violet-line)] bg-[var(--violet-soft)] font-bold text-[var(--violet-fg)]' : 'border-[var(--line)] font-semibold text-[var(--color-text-secondary)]'}`}>
          Proposals{pendingCount > 0 && !proposalsOpen && (
            <span className="ml-1 inline-flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[var(--violet)] text-[9px] font-extrabold text-white">{pendingCount}</span>
          )}
        </button>
        {/* Import Claude Code's project memory */}
        <button
          onClick={async () => {
            if (memBusy) return
            setMemBusy(true); setMemNote('')
            try {
              const r = await fetch(`${amBase()}/api/ingest/claude-memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
              const j = (await r.json()) as { ingested?: number; chunks?: number; error?: string }
              if (!r.ok || j.error) throw new Error(j.error ?? `ingest ${r.status}`)
              setMemNote(`Imported ${j.ingested ?? 0} memory files (${j.chunks ?? 0} chunks)`) ; void load()
            } catch (e) { setMemNote(`Import failed: ${e instanceof Error ? e.message : 'error'}`) }
            finally { setMemBusy(false); setTimeout(() => setMemNote(''), 6000) }
          }}
          disabled={memBusy}
          title="Ingest Claude Code's project memory files into the knowledge graph"
          className="cursor-pointer whitespace-nowrap rounded-[7px] border border-[var(--line)] px-[10px] py-[4px] text-[11px] font-semibold text-[var(--color-text-secondary)] disabled:opacity-50">
          {memBusy ? 'Importing…' : 'Import Claude memory'}
        </button>
        <button onClick={() => void load()} className="cursor-pointer whitespace-nowrap rounded-[7px] border border-[var(--line)] px-[10px] py-[4px] text-[11px] font-semibold text-[var(--color-text-secondary)]">Refresh</button>
      </div>
      {memNote && <div className="px-3 pb-1 text-[10px] text-[var(--color-text-tertiary)]">{memNote}</div>}

      {/* Legend */}
      {kindsPresent.length > 0 && (
        <div className="flex h-[32px] items-center gap-[14px] overflow-x-auto border-b border-[var(--line-soft)] bg-[var(--color-background-secondary)] px-4">
          {kindsPresent.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-[var(--color-text-secondary)]">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}
            </span>
          ))}
        </div>
      )}

      {/* Graph + proposals panel */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Graph */}
        <div className="relative min-h-0 flex-1 bg-[var(--paper)]">
          {err ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[var(--color-text-danger,#dc2626)]">{err}</div>
          ) : graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-tertiary)]">{loading ? 'Loading graph…' : 'No nodes in this view. Ingest a repo or documents to populate the graph.'}</div>
          ) : (
            <SurfaceGraph nodes={graph.nodes} links={graph.links} fill layout={layout} colorBy="class" sizeBy="degree"
              onNodeClick={(id: string) => { setRoot(id); setRootInput(id) }} />
          )}
          {loading && graph.nodes.length > 0 && <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">updating…</div>}
        </div>

        {/* Proposals side panel */}
        {proposalsOpen && (
          <div className="flex w-[300px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--color-background-primary)]">
            <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-[var(--line-soft)] px-[14px]">
              <span className="text-[13px] font-bold text-[var(--color-text-primary)]">Graph Proposals</span>
              {pendingCount > 0 && (
                <span className="rounded-full bg-[var(--violet-soft)] px-[7px] py-[2px] text-[10px] font-bold text-[var(--violet-fg)]">{pendingCount} pending</span>
              )}
              <div className="flex-1" />
              <button onClick={() => setProposalsOpen(false)} className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full border border-[var(--line)] text-[10px] text-[var(--color-text-secondary)]">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {proposals.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <div className="text-[12px] font-semibold text-[var(--color-text-secondary)]">No proposals yet</div>
                  <div className="max-w-[200px] text-[11px] leading-[1.6] text-[var(--color-text-tertiary)]">The agent will stage proposed graph changes here. You review and accept or reject each one before anything is written.</div>
                </div>
              ) : (
                <div>
                  {proposals.map((p) => {
                    const busy = proposalBusy.has(p.id)
                    return (
                      <div key={p.id} className={`border-b border-[var(--line-soft)] px-[14px] py-[12px] ${p.status !== 'pending' ? 'opacity-50' : ''}`}>
                        <div className="mb-1 flex items-center gap-[6px]">
                          <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: OP_COLOR[p.op] + '20', color: OP_COLOR[p.op] }}>{OP_LABEL[p.op]}</span>
                          {p.source && <span className="text-[9px] text-[var(--color-text-tertiary)]">{p.source}</span>}
                          {p.status !== 'pending' && (
                            <span className={`ml-auto text-[9px] font-bold ${p.status === 'accepted' ? 'text-[var(--verified-fg)]' : 'text-[var(--danger-fg)]'}`}>{p.status}</span>
                          )}
                        </div>
                        <div className="mb-[5px] font-mono text-[11px] leading-[1.4] text-[var(--color-text-primary)]">{proposalSummary(p)}</div>
                        {p.rationale && (
                          <div className="mb-2 text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">{p.rationale}</div>
                        )}
                        {p.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              disabled={busy}
                              onClick={() => void actOnProposal(p.id, 'accept')}
                              className="flex-1 rounded-[8px] bg-[var(--verified)] py-[5px] text-center text-[11px] font-bold text-white disabled:opacity-40">
                              {busy ? '…' : 'Accept'}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => void actOnProposal(p.id, 'reject')}
                              className="flex-1 rounded-[8px] border border-[var(--danger)] py-[5px] text-center text-[11px] font-bold text-[var(--danger-fg)] disabled:opacity-40">
                              {busy ? '…' : 'Reject'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {proposals.some((p) => p.status === 'pending') && (
              <div className="flex shrink-0 gap-2 border-t border-[var(--line-soft)] px-[14px] py-[10px]">
                <button
                  onClick={async () => {
                    for (const p of proposals.filter((x) => x.status === 'pending')) {
                      await actOnProposal(p.id, 'accept')
                    }
                  }}
                  className="flex-1 rounded-[9px] bg-[var(--verified)] py-[7px] text-center text-[12px] font-bold text-white">
                  Accept all
                </button>
                <button
                  onClick={async () => {
                    for (const p of proposals.filter((x) => x.status === 'pending')) {
                      await actOnProposal(p.id, 'reject')
                    }
                  }}
                  className="flex-1 rounded-[9px] border border-[var(--danger)] py-[7px] text-center text-[12px] font-bold text-[var(--danger-fg)]">
                  Reject all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

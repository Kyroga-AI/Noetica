'use client'

import { useCallback, useEffect, useState } from 'react'
import { SurfaceGraph, KIND_COLOR, KIND_ORDER, EPISTEMIC_COLORS, EPISTEMIC_ORDER, type GraphNode, type GraphLink, type GraphLayout } from '@/components/graph/SurfaceGraph'

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
  'add-node':    'var(--color-accent)',
  'add-edge':    '#2563eb',
  'remove-edge': '#dc2626',
  'update-prop': 'var(--color-attention)',
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
  const [colorBy, setColorBy] = useState<'class' | 'epistemic'>('class')
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
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Knowledge Graph</span>
          {(() => {
            // Real health, not a hardcoded green pill: red when the graph fetch errored, amber while
            // loading / empty, green ONLY when HellGraph actually returned data.
            const healthy = !err && (graph.nodes.length > 0 || (total?.nodes ?? 0) > 0)
            const cls = err ? 'bg-[#fee2e2] text-[#dc2626]' : healthy ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[#fef3c7] text-[var(--color-attention)]'
            const dot = err ? 'bg-[#dc2626]' : healthy ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-attention)]'
            const label = err ? 'HellGraph · unreachable' : healthy ? 'HellGraph · on-device' : loading ? 'HellGraph · loading…' : 'HellGraph · no data'
            return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`} title={err || undefined}><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{label}</span>
          })()}
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
        {/* Colour-by: class (what a node IS) vs epistemic (how well it's KNOWN) — the shared moat lens, same as Lattice Studio */}
        <div className="flex items-center gap-1" title="Colour nodes by entity class, or by epistemic status (the shared trust lens)">
          {(['class', 'epistemic'] as const).map((c) => (
            <button key={c} onClick={() => setColorBy(c)}
              className={`rounded-lg px-2 py-1 text-[10px] font-medium capitalize transition ${colorBy === c ? 'bg-[#ede9fe] text-[#7c3aed]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>{c}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
          <span>{graph.nodes.length} nodes · {graph.links.length} edges shown{total?.nodes != null ? ` of ${total.nodes}` : ''}</span>
          {/* Proposals button — badge when pending */}
          <button
            onClick={() => { setProposalsOpen((v) => !v); if (!proposalsOpen) void loadProposals() }}
            className={`relative rounded-lg border px-2 py-1 font-medium transition ${proposalsOpen ? 'border-[#7c3aed] bg-[#ede9fe] text-[#7c3aed]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>
            Proposals
            {pendingCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#7c3aed] text-[9px] font-bold text-white">{pendingCount}</span>
            )}
          </button>
          {/* Import Claude Code's project memory (the markdown files under ~/.claude/projects) into the brain. */}
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
            className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] disabled:opacity-50">
            {memBusy ? 'Importing…' : 'Import Claude memory'}
          </button>
          <button onClick={() => void load()} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">Refresh</button>
        </div>
      </div>
      {memNote && <div className="px-3 pb-1 text-[10px] text-[var(--color-text-tertiary)]">{memNote}</div>}

      {/* Legend — mirrors the active colour lens: entity class, or the shared epistemic ladder (the moat). */}
      {colorBy === 'epistemic' ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-1.5">
          <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)]">epistemic status</span>
          {EPISTEMIC_ORDER.filter((e) => graph.nodes.some((n) => (n as { epistemic?: string }).epistemic === e)).map((e) => (
            <span key={e} className="inline-flex items-center gap-1 text-[9px] text-[var(--color-text-secondary)]">
              <span className="h-2 w-2 rounded-full" style={{ background: EPISTEMIC_COLORS[e] }} />{e}
            </span>
          ))}
          <span className="text-[9px] text-[var(--color-text-tertiary)]">— how well each fact is known, not just what it is</span>
        </div>
      ) : kindsPresent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-1.5">
          {kindsPresent.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-[9px] text-[var(--color-text-secondary)]">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}
            </span>
          ))}
        </div>
      )}

      {/* Graph + proposals panel */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Graph */}
        <div className="relative min-h-0 flex-1">
          {err ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[#dc2626]">{err}</div>
          ) : graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-tertiary)]">{loading ? 'Loading graph…' : 'No nodes in this view. Ingest a repo or documents to populate the graph.'}</div>
          ) : (
            <SurfaceGraph nodes={graph.nodes} links={graph.links} fill layout={layout} colorBy={colorBy} sizeBy="degree"
              onNodeClick={(id: string) => { setRoot(id); setRootInput(id) }} />
          )}
          {loading && graph.nodes.length > 0 && <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">updating…</div>}
        </div>

        {/* Proposals side panel */}
        {proposalsOpen && (
          <div className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-tertiary)] px-4 py-2.5">
              <div>
                <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">Graph Proposals</span>
                {pendingCount > 0 && (
                  <span className="ml-2 rounded-full bg-[#ede9fe] px-1.5 py-0.5 text-[9px] font-semibold text-[#7c3aed]">{pendingCount} pending</span>
                )}
              </div>
              <button onClick={() => setProposalsOpen(false)} className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {proposals.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">No proposals yet</div>
                  <div className="max-w-[200px] text-[10px] leading-relaxed text-[var(--color-text-tertiary)]">The agent will stage proposed graph changes here. You review and accept or reject each one before anything is written.</div>
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border-tertiary)]">
                  {proposals.map((p) => {
                    const busy = proposalBusy.has(p.id)
                    return (
                      <div key={p.id} className={`px-4 py-3 ${p.status !== 'pending' ? 'opacity-50' : ''}`}>
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: OP_COLOR[p.op] + '20', color: OP_COLOR[p.op] }}>{OP_LABEL[p.op]}</span>
                          {p.source && <span className="text-[9px] text-[var(--color-text-tertiary)]">{p.source}</span>}
                          {p.status !== 'pending' && (
                            <span className={`ml-auto text-[9px] font-semibold ${p.status === 'accepted' ? 'text-[var(--color-accent)]' : 'text-[#dc2626]'}`}>{p.status}</span>
                          )}
                        </div>
                        <div className="mb-1 font-mono text-[11px] text-[var(--color-text-primary)]">{proposalSummary(p)}</div>
                        {p.rationale && (
                          <div className="mb-2 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">{p.rationale}</div>
                        )}
                        {p.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              disabled={busy}
                              onClick={() => void actOnProposal(p.id, 'accept')}
                              className="flex-1 rounded-lg bg-[var(--color-accent)] py-1 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40">
                              {busy ? '…' : 'Accept'}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => void actOnProposal(p.id, 'reject')}
                              className="flex-1 rounded-lg border border-[#dc2626] py-1 text-[10px] font-semibold text-[#dc2626] transition hover:bg-[#fef2f2] disabled:opacity-40">
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
              <div className="flex shrink-0 gap-2 border-t border-[var(--color-border-tertiary)] px-4 py-2.5">
                <button
                  onClick={async () => {
                    for (const p of proposals.filter((x) => x.status === 'pending')) {
                      await actOnProposal(p.id, 'accept')
                    }
                  }}
                  className="flex-1 rounded-lg bg-[var(--color-accent)] py-1.5 text-[10px] font-semibold text-white transition hover:opacity-90">
                  Accept all
                </button>
                <button
                  onClick={async () => {
                    for (const p of proposals.filter((x) => x.status === 'pending')) {
                      await actOnProposal(p.id, 'reject')
                    }
                  }}
                  className="flex-1 rounded-lg border border-[#dc2626] py-1.5 text-[10px] font-semibold text-[#dc2626] transition hover:bg-[#fef2f2]">
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

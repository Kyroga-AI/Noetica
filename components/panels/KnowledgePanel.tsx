'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'
import { useUiStore, type KnowledgeFilter } from '@/lib/store/uiStore'
import { SurfaceGraph, type GraphNode, type GraphLink } from '@/components/graph/SurfaceGraph'

interface GraphHealth {
  status: 'healthy' | 'degraded' | 'unknown'
  nodeCount: number
  edgeCount: number
  orphanNodeCount: number
}
interface HealthResponse { graph: GraphHealth }
interface KHealth { score: number; gaps: string[] }
interface Insights { topImportant: string[]; topBridges: string[] }
interface DigestInsight { text: string }

const FILTERS: { key: KnowledgeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tech', label: 'Tech' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'memory', label: 'Memory' },
  { key: 'document', label: 'Docs' },
  { key: 'domain', label: 'Glossary' },
]

function openSurface(surface: string) {
  window.dispatchEvent(new CustomEvent('noetica:navigate', { detail: surface }))
}

// Right-rail Knowledge panel — 300px, replaces the old embedded force-directed graph (GraphRailPanel)
// with a simpler, plain-language summary that links out to the full Knowledge Graph surface for the
// detailed view. Backed by the same real endpoints GraphRailPanel already used (graph/health,
// graph/knowledge-health, graph/analytics, graph/digest) — no fabricated demo numbers.
export function KnowledgePanel({
  inScopeFiles = [],
  toolActivity = [],
}: {
  inScopeFiles?: string[]
  toolActivity?: { id: string; name: string; target: string }[]
}) {
  const filter = useUiStore((s) => s.knowledgeFilter)
  const setFilter = useUiStore((s) => s.setKnowledgeFilter)
  const [health, setHealth] = useState<GraphHealth | null>(null)
  const [kHealth, setKHealth] = useState<KHealth | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [digest, setDigest] = useState<DigestInsight[]>([])
  const [readingOpen, setReadingOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch(amUrl('/api/graph/health'))
        if (r.ok) { const j = (await r.json()) as HealthResponse; if (!cancelled) setHealth(j.graph) }
      } catch { /* offline — leave last value */ }
    }
    void poll()
    const id = setInterval(() => void poll(), 8000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(amUrl('/api/graph/analytics'))
        if (r.ok) {
          const j = (await r.json()) as { summary?: { topByPagerank: Array<{ label: string }>; topByBetweenness: Array<{ label: string }> } }
          if (!cancelled && j.summary) setInsights({ topImportant: j.summary.topByPagerank.slice(0, 6).map((x) => x.label), topBridges: j.summary.topByBetweenness.slice(0, 4).map((x) => x.label) })
        }
      } catch { /* offline */ }
      try {
        const hr = await fetch(amUrl('/api/graph/knowledge-health'))
        if (hr.ok) { const hj = (await hr.json()) as KHealth; if (!cancelled) setKHealth(hj) }
      } catch { /* offline */ }
      try {
        const dr = await fetch(amUrl('/api/graph/digest'))
        if (dr.ok) { const dj = (await dr.json()) as { insights?: DigestInsight[] }; if (!cancelled) setDigest(dj.insights ?? []) }
      } catch { /* offline */ }
    })()
    return () => { cancelled = true }
  }, [])

  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([])
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>([])

  const loadGraph = useCallback(async () => {
    try {
      const r = await fetch(amUrl('/api/graph/surface?limit=40'))
      if (r.ok) {
        const j = (await r.json()) as { nodes?: GraphNode[]; links?: GraphLink[] }
        setGraphNodes(j.nodes ?? [])
        setGraphLinks(j.links ?? [])
      }
    } catch { /* offline */ }
  }, [])

  useEffect(() => { void loadGraph() }, [loadGraph])

  const healthPct = kHealth ? Math.round(kHealth.score * 100) : null
  const topConcepts = insights?.topImportant ?? []
  const bridgeConcepts = insights?.topBridges ?? []

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto" style={{ background: 'var(--paper-sunk)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3.5 py-3" style={{ borderColor: 'var(--line)' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ color: 'var(--ink2)' }}>
          <path d="M8 1.5c-2.2 0-3.8 1.6-3.8 3.6 0 1.1.5 2 1.2 2.7v2.7a1 1 0 001 1h3.2a1 1 0 001-1V7.8c.7-.7 1.2-1.6 1.2-2.7 0-2-1.6-3.6-3.8-3.6z" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M8 3v6.5M6 14h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
        </svg>
        <span className="text-[14px] font-extrabold" style={{ color: 'var(--ink)' }}>Knowledge</span>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition"
              style={active
                ? { background: 'var(--accent)', color: '#fff' }
                : { border: '1px solid var(--line)', color: 'var(--ink2)', background: 'transparent' }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Knowledge health */}
      <div className="mx-3.5 mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--ink3)' }}>Knowledge health</span>
          <span className="text-[13px] font-extrabold" style={{ color: 'var(--verified-fg)' }}>{healthPct !== null ? `${healthPct}%` : '—'}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--paper-sunk-2)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${healthPct ?? 0}%`, background: 'var(--verified)' }} />
        </div>
        {kHealth && kHealth.gaps.length > 0 && (
          <div className="mt-2.5 flex items-start gap-1.5 border-t pt-2" style={{ borderColor: 'var(--line-soft)' }}>
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--pending)' }} />
            <span className="text-[11px] leading-snug" style={{ color: 'var(--ink2)' }}>{kHealth.gaps[0]}</span>
          </div>
        )}
      </div>

      {/* Callout — first proactive digest insight */}
      {digest.length > 0 && (
        <div className="mx-3.5 mt-2.5 rounded-xl p-3" style={{ background: 'var(--pending-soft)', border: '1px solid var(--pending-line)' }}>
          <div className="flex items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--pending)' }} />
            <span className="text-[11px] leading-snug" style={{ color: 'var(--pending-fg)' }}>{digest[0].text}</span>
          </div>
        </div>
      )}

      {/* Mini graph */}
      <div className="mx-3.5 mt-3" style={{ height: 260, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line-soft)', background: 'var(--paper-sunk)', position: 'relative', flexShrink: 0 }}>
        {graphNodes.length > 0 ? (
          <SurfaceGraph nodes={graphNodes} links={graphLinks} fill layout="force" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-[11px]" style={{ color: 'var(--ink3)' }}>Loading graph&hellip;</span>
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 8, right: 10 }}>
          <button
            onClick={() => openSurface('kg')}
            style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--paper)', border: '1px solid var(--line)', fontSize: '10.5px', fontWeight: 700, color: 'var(--ink2)', cursor: 'pointer' }}
          >
            Open full graph →
          </button>
        </div>
      </div>

      {/* Key concepts word cloud */}
      {(topConcepts.length > 0 || bridgeConcepts.length > 0) && (
        <div className="mx-3.5 mt-3">
          <div className="text-[11px] font-bold" style={{ color: 'var(--ink)' }}>Key concepts</div>
          <div className="mt-0.5 text-[10px]" style={{ color: 'var(--ink3)' }}>larger &amp; darker = more important</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topConcepts.map((label) => (
              <span key={label} className="rounded-full px-3 py-1.5 text-[13px] font-extrabold" style={{ background: 'var(--accent)', color: '#fff' }}>{label}</span>
            ))}
            {bridgeConcepts.map((label) => (
              <span key={label} className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--paper-sunk-2)', color: 'var(--ink2)' }}>{label}</span>
            ))}
          </div>
        </div>
      )}

      {/* Footer stats */}
      <div className="mx-3.5 mt-3 flex divide-x rounded-xl border py-2.5 text-center" style={{ borderColor: 'var(--line)' }}>
        {[
          ['things', health?.nodeCount],
          ['connections', health?.edgeCount],
          ['unlinked', health?.orphanNodeCount],
        ].map(([label, value]) => (
          <div key={label as string} className="flex-1 px-1" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[16px] font-extrabold" style={{ color: 'var(--ink)' }}>{value !== undefined && value !== null ? value : '—'}</div>
            <div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>{label as string}</div>
          </div>
        ))}
      </div>

      {/* What Noetica is reading */}
      <div className="mx-3.5 mt-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        <button onClick={() => setReadingOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-[11px] font-bold" style={{ color: 'var(--ink)' }}>What Noetica is reading</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ transform: readingOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.12s', color: 'var(--ink3)' }}>
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {readingOpen && (
          <div className="mt-2 space-y-1.5">
            {inScopeFiles.length === 0 && toolActivity.length === 0 && (
              <div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>No files in scope right now.</div>
            )}
            {inScopeFiles.map((f) => (
              <div key={f} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0" style={{ background: 'var(--verified)' }} />
                <span className="truncate font-mono text-[10.5px]" style={{ color: 'var(--ink2)' }}>{f}</span>
              </div>
            ))}
            {toolActivity.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--ink3)' }}>Active tools</div>
                {toolActivity.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--pending)', animation: 'pulseDot 1.6s infinite' }} />
                    <span className="text-[10.5px]" style={{ color: 'var(--ink2)' }}>{t.name} → {t.target}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mx-3.5 my-3" />
    </div>
  )
}

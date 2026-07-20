'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SurfaceGraph, KIND_COLOR, KIND_ORDER, DIM_COLOR, DIM_ORDER, type GraphNode, type GraphLink, type GraphLayout } from '@/components/graph/SurfaceGraph'
import { amUrl } from '@/lib/tauri/bridge'

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
  { key: 'memory', label: 'Memory' },
  { key: 'document', label: 'Docs' },
  { key: 'domain', label: 'Glossary' },
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
  const [pathExplain, setPathExplain] = useState<{ explanation: string; confidence: number; hops: number } | null>(null)
  // GDS overlay (size by PageRank importance, colour by Louvain community) + GraphRAG themes.
  const [colorBy, setColorBy] = useState<'class' | 'community'>('class')
  const [sizeBy, setSizeBy] = useState<'degree' | 'importance'>('degree')
  const [metrics, setMetrics] = useState<Record<string, { pagerank: number; betweenness: number; community: number }>>({})
  const [insights, setInsights] = useState<{ communityCount: number; modularity: number; topImportant: string[]; topBridges: string[] } | null>(null)
  const [kHealth, setKHealth] = useState<{ score: number; gaps: string[] } | null>(null)
  const [digest, setDigest] = useState<Array<{ severity: string; icon: string; message: string }>>([])
  const [digestIdx, setDigestIdx] = useState(0)
  const [digestDismissed, setDigestDismissed] = useState(false)
  const [recs, setRecs] = useState<Array<{ id: string; label: string; reasons: string[]; connected: boolean }>>([])
  // unsurfaced-capability state: NL→Cypher, alerts (anomalies+contradictions), entity resolution, inference, impact
  const [nlResult, setNlResult] = useState<{ cypher: string; executed?: boolean; error?: string; op?: string; count?: number; rows?: Array<Record<string, unknown>> } | null>(null)
  const [nlLoading, setNlLoading] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [anomalies, setAnomalies] = useState<Array<{ label: string; kind: string; detail: string }>>([])
  const [contradictions, setContradictions] = useState<Array<{ claimA: string; claimB: string; kind: string; current?: string; resolution: string }>>([])
  const [mergeCands, setMergeCands] = useState<Array<{ a: string; b: string; confidence: number; reason: string }>>([])
  const [inferred, setInferred] = useState<Array<{ subject: string; predicate: string; object: string; via: string; verified?: boolean }>>([])
  const [toolsLoading, setToolsLoading] = useState('')
  const [impact, setImpact] = useState<{ totalAffected: number; levels: Array<{ distance: number; count: number }> } | null>(null)
  const [gaia, setGaia] = useState<{ phases: Array<{ phase: string; count: number }>; signals: Array<{ signal: string; count: number; examples: string[] }> } | null>(null)

  async function askGraphQuery() {
    const question = globalQ.trim()
    if (!question || nlLoading) return
    setNlLoading(true); setNlResult(null)
    try {
      const res = await fetch(amUrl('/api/graph/nlquery'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
      if (res.ok) setNlResult(await res.json() as NonNullable<typeof nlResult>)
    } catch { /* offline */ } finally { setNlLoading(false) }
  }
  async function loadTools() {
    setToolsLoading('all')
    try {
      const [an, co, rs, inf, on] = await Promise.all([
        fetch(amUrl('/api/graph/anomalies')), fetch(amUrl('/api/graph/contradictions')), fetch(amUrl('/api/graph/resolve')), fetch(amUrl('/api/graph/infer')), fetch(amUrl('/api/graph/ontology')),
      ])
      if (an.ok) setAnomalies(((await an.json()) as { anomalies?: typeof anomalies }).anomalies ?? [])
      if (co.ok) setContradictions(((await co.json()) as { contradictions?: typeof contradictions }).contradictions ?? [])
      if (rs.ok) setMergeCands(((await rs.json()) as { candidates?: typeof mergeCands }).candidates ?? [])
      if (inf.ok) setInferred(((await inf.json()) as { inferred?: typeof inferred }).inferred ?? [])
      if (on.ok) setGaia(((await on.json()) as { census?: typeof gaia }).census ?? null)
    } catch { /* offline */ } finally { setToolsLoading('') }
  }
  const [showThemes, setShowThemes] = useState(false)
  const [communities, setCommunities] = useState<Array<{ id: number; title: string; summary: string; trust: number; grounded: boolean; size: number; topNodes: string[]; claims?: Array<{ text: string; grounded: boolean; score: number }> }>>([])
  const [themesLoading, setThemesLoading] = useState(false)
  const [globalQ, setGlobalQ] = useState('')
  const [globalAnswer, setGlobalAnswer] = useState<{ answer: string; trust: number; grounded: boolean; communitiesUsed: Array<{ title: string }>; localUsed?: number; mode?: string; followups?: string[]; sources?: string[] } | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [predictions, setPredictions] = useState<Array<{ source: string; target: string; sourceLabel: string; targetLabel: string; score: number; commonNeighbors: number; verified?: boolean; relation?: string; confidence?: number; rationale?: string }>>([])
  const [predLoading, setPredLoading] = useState(false)
  const [deepMode, setDeepMode] = useState(false)   // DRIFT iterative fan-out on the global ask
  const [covariates, setCovariates] = useState<Array<{ entity: string; grounded: number; covariates: Array<{ type: string; claim: string; object?: string; grounded: boolean; score: number }> }>>([])
  const [covLoading, setCovLoading] = useState(false)
  const [showCov, setShowCov] = useState(false)
  const [domain, setDomain] = useState<{ domain: string; persona: string } | null>(null)
  const [showTimeline, setShowTimeline] = useState(false)
  const [timeline, setTimeline] = useState<{ from: number; to: number; total: number; buckets: Array<{ start: number; end: number; newNodes: number; cumulative: number; newConcepts: string[] }> } | null>(null)
  const [tlLoading, setTlLoading] = useState(false)
  const [tlSel, setTlSel] = useState<number | null>(null)

  // SVG export: parent captures the live SVG element via onSvgMount, then serializes it on demand.
  const svgExportRef = useRef<SVGSVGElement | null>(null)
  const onSvgMount = useCallback((el: SVGSVGElement | null) => { svgExportRef.current = el }, [])

  function exportSvg() {
    const svg = svgExportRef.current; if (!svg) return
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `sociosphere-${view}.svg`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  function exportPng() {
    const svg = svgExportRef.current; if (!svg) return
    const { width: w, height: h } = svg.getBoundingClientRect()
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w * 2; canvas.height = h * 2   // 2× for retina
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2); ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => {
        if (!b) return
        const pu = URL.createObjectURL(b)
        const a = document.createElement('a'); a.href = pu; a.download = `sociosphere-${view}.png`; a.click()
        setTimeout(() => { URL.revokeObjectURL(pu); URL.revokeObjectURL(url) }, 5000)
      }, 'image/png')
    }
    img.src = url
  }

  async function loadThemes() {
    setThemesLoading(true)
    try {
      const res = await fetch(amUrl('/api/graph/communities'))
      if (res.ok) { const j = await res.json() as { communities?: typeof communities }; setCommunities(j.communities ?? []) }
    } catch { /* offline */ } finally { setThemesLoading(false) }
  }
  async function askGlobal() {
    const question = globalQ.trim()
    if (!question || globalLoading) return
    setGlobalLoading(true); setGlobalAnswer(null)
    try {
      const res = await fetch(amUrl('/api/graph/global'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, drift: deepMode }) })
      if (res.ok) setGlobalAnswer(await res.json() as NonNullable<typeof globalAnswer>)
    } catch { /* offline */ } finally { setGlobalLoading(false) }
  }
  async function loadCovariates() {
    setCovLoading(true)
    try {
      const [cv, tn] = await Promise.all([fetch(amUrl('/api/graph/covariates')), fetch(amUrl('/api/graph/tune'))])
      if (cv.ok) { const j = await cv.json() as { entities?: typeof covariates }; setCovariates(j.entities ?? []) }
      if (tn.ok) { const j = await tn.json() as { domain: string; persona: string }; setDomain({ domain: j.domain, persona: j.persona }) }
    } catch { /* offline */ } finally { setCovLoading(false) }
  }
  async function loadPredictions() {
    setPredLoading(true)
    try {
      const res = await fetch(amUrl('/api/graph/predictions?verify=1&topK=10'))
      if (res.ok) { const j = await res.json() as { predictions?: typeof predictions }; setPredictions(j.predictions ?? []) }
    } catch { /* offline */ } finally { setPredLoading(false) }
  }
  async function loadTimeline() {
    setTlLoading(true)
    try {
      const res = await fetch(amUrl('/api/graph/timeline?buckets=14'))
      if (res.ok) setTimeline(await res.json() as NonNullable<typeof timeline>)
    } catch { /* offline */ } finally { setTlLoading(false) }
  }

  // Demo path: fire a path between the two highest-importance nodes so a demo looks instantly compelling.
  const [demoPending, setDemoPending] = useState(false)
  async function triggerDemoPath() {
    const nodeIds = graph.nodes.map((n) => n.id)
    if (nodeIds.length < 2) return
    // prefer top-importance nodes from insights; fall back to first two graph nodes
    const m = metrics
    const sorted = nodeIds.slice().sort((a, b) => (m[b]?.pagerank ?? 0) - (m[a]?.pagerank ?? 0))
    const from = sorted[0]!, to = sorted[Math.min(4, sorted.length - 1)]!
    setDemoPending(true); setPathIds([]); setPathExplain(null)
    try {
      const [pr, er] = await Promise.all([
        fetch(amUrl(`/api/graph/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
        fetch(amUrl(`/api/graph/explain-path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
      ])
      const pj = (await pr.json()) as { path?: { id: string }[] }
      setPathIds((pj.path ?? []).map((p) => p.id))
      if (er.ok) { const ej = (await er.json()) as { explanation?: string; confidence?: number; length?: number }; setPathExplain({ explanation: ej.explanation ?? '', confidence: ej.confidence ?? 0, hops: ej.length ?? 0 }) }
    } catch { /* offline */ } finally { setDemoPending(false) }
  }

  async function handleNodeClick(id: string) {
    if (!pathMode) { setRoot(id); return }
    if (!pathFrom) { setPathFrom(id); return }   // first pick = source
    try {
      const [pr, er] = await Promise.all([
        fetch(amUrl(`/api/graph/path?from=${encodeURIComponent(pathFrom)}&to=${encodeURIComponent(id)}`)),
        fetch(amUrl(`/api/graph/explain-path?from=${encodeURIComponent(pathFrom)}&to=${encodeURIComponent(id)}`)),
      ])
      const pj = (await pr.json()) as { path?: { id: string }[] }
      setPathIds((pj.path ?? []).map((p) => p.id))
      if (er.ok) { const ej = (await er.json()) as { explanation?: string; confidence?: number; length?: number }; setPathExplain({ explanation: ej.explanation ?? '', confidence: ej.confidence ?? 0, hops: ej.length ?? 0 }) }
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
        const res = await fetch(amUrl('/api/graph/health'))
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
        const res = await fetch(amUrl(q))
        if (!res.ok) { if (!cancelled) setError(true); return }
        const json = (await res.json()) as { nodes: GraphNode[]; links: GraphLink[] }
        if (!cancelled) { setGraph({ nodes: json.nodes ?? [], links: json.links ?? [] }); setError(false) }
      } catch { if (!cancelled) setError(true) }   // surface unreachable → show the banner, don't fail silent
    }
    void load()
    return () => { cancelled = true }
  }, [view, root])

  // GDS metrics overlay (PageRank / community / betweenness), keyed by node id — cheap + cached
  // server-side, so re-fetching on view change is fine; metrics merge onto whatever nodes are shown.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(amUrl('/api/graph/analytics'))
        if (!res.ok) return
        const j = (await res.json()) as { nodes?: Record<string, { pagerank: number; betweenness: number; community: number }>; modularity?: number; summary?: { communityCount: number; topByPagerank: Array<{ label: string }>; topByBetweenness: Array<{ label: string }> } }
        if (!cancelled && j.nodes) setMetrics(j.nodes)
        if (!cancelled && j.summary) setInsights({ communityCount: j.summary.communityCount, modularity: j.modularity ?? 0, topImportant: j.summary.topByPagerank.slice(0, 4).map((x) => x.label), topBridges: j.summary.topByBetweenness.slice(0, 3).map((x) => x.label) })
        // knowledge-health synthesis — cheap, aggregates the verified-stack signals into one score
        try { const hr = await fetch(amUrl('/api/graph/knowledge-health')); if (hr.ok) { const hj = (await hr.json()) as { score: number; gaps: string[] }; if (!cancelled) setKHealth({ score: hj.score, gaps: hj.gaps ?? [] }) } } catch { /* offline */ }
        // proactive digest — the graph surfaces what needs attention without being asked
        try { const dr = await fetch(amUrl('/api/graph/digest')); if (dr.ok) { const dj = (await dr.json()) as { insights?: typeof digest }; if (!cancelled) { setDigest(dj.insights ?? []); setDigestIdx(0); setDigestDismissed(false) } } } catch { /* offline */ }
        // auto-seed communities for the demo so Themes panel is populated on first open
        try { const cr = await fetch(amUrl('/api/graph/communities')); if (cr.ok) { const cj = (await cr.json()) as { communities?: typeof communities }; if (!cancelled && cj.communities && cj.communities.length > 0) setCommunities(cj.communities) } } catch { /* offline */ }
      } catch { /* offline */ }
    })()
    return () => { cancelled = true }
  }, [view])

  // Guided exploration: when a node is focused, fetch "explore next" recommendations + impact (blast radius).
  useEffect(() => {
    if (!root) { setRecs([]); setImpact(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const [rc, im] = await Promise.all([
          fetch(amUrl(`/api/graph/recommend?entity=${encodeURIComponent(root)}&k=6`)),
          fetch(amUrl(`/api/graph/impact?entity=${encodeURIComponent(root)}&hops=2`)),
        ])
        if (rc.ok && !cancelled) setRecs(((await rc.json()) as { recommendations?: typeof recs }).recommendations ?? [])
        if (im.ok && !cancelled) { const j = (await im.json()) as NonNullable<typeof impact>; setImpact({ totalAffected: j.totalAffected, levels: j.levels }) }
      } catch { /* offline */ }
    })()
    return () => { cancelled = true }
  }, [root])

  // graph search — cosine + Jaccard + link expansion (debounced)
  useEffect(() => {
    const q = searchQ.trim()
    if (q.length < 2) { setSearchHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(amUrl(`/api/graph/search?q=${encodeURIComponent(q)}&limit=8`))
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
      const res = await fetch(amUrl('/api/memory/graph')); if (!res.ok) return
      const j = (await res.json()) as { memories?: Array<{ id: string; pinned: boolean; kind: string; preview: string }> }
      const m: Record<string, { pinned: boolean; kind: string; preview: string }> = {}
      for (const x of j.memories ?? []) m[x.id] = { pinned: x.pinned, kind: x.kind, preview: x.preview }
      setMemMap(m)
    } catch { /* offline */ }
  }
  useEffect(() => { void loadMemories() }, [])
  const togglePin = async (id: string, pinned: boolean) => {
    setMemMap((cur) => ({ ...cur, [id]: { ...(cur[id] ?? { kind: 'memory', preview: '' }), pinned } }))  // optimistic
    try { await fetch(amUrl('/api/memory/pin'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, pinned }) }) } catch { /* */ }
    void loadMemories()
  }
  const forgetMem = async (id: string) => {
    setMemMap((cur) => { const n = { ...cur }; delete n[id]; return n })  // optimistic remove
    setRoot('')                                                          // node leaves the graph on next load
    try { await fetch(amUrl('/api/memory/forget'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }) } catch { /* */ }
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
            {/* Demo path: highlight the highest-PageRank cross-graph connection at a click */}
            <button onClick={() => void triggerDemoPath()} disabled={demoPending || graph.nodes.length < 2} title="Demo: highlight the most important knowledge path" aria-label="Demo path"
              className="text-[var(--color-text-tertiary)] transition hover:text-[#7c3aed] disabled:opacity-40">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="3" cy="8" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="13" cy="8" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M8 5.5c0-1 1-2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </button>
            {/* SVG export → share as image */}
            <button onClick={exportSvg} title="Export graph as SVG" aria-label="Export SVG"
              className="text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 1v9M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            {/* PNG export → screenshot-quality image */}
            <button onClick={exportPng} title="Export graph as PNG" aria-label="Export PNG"
              className="text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 10.5l3-3 2.5 2.5 3-4 4 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <a href="/api/graph/export?format=graphml" download title="Export graph (GraphML — opens in Gephi/Cytoscape)" aria-label="Export GraphML"
              className="text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
            </a>
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
            {pathMode ? (pathFrom ? 'pick target…' : 'pick source…') : 'path'}
          </button>
          {pathIds.length > 0 && <button onClick={() => { setPathIds([]); setPathExplain(null) }} className="text-[#f59e0b]">clear</button>}
        </div>
        {pathExplain && pathExplain.explanation && (
          <div className="mt-1 rounded-lg border border-[#f59e0b]/40 bg-[var(--color-background-secondary)] px-2.5 py-1.5">
            <p className="text-[10px] leading-snug text-[var(--color-text-secondary)]">{pathExplain.explanation}</p>
            <span className="text-[9px] text-[var(--color-text-tertiary)]">{pathExplain.hops} hop{pathExplain.hops === 1 ? '' : 's'} · path confidence {pathExplain.confidence.toFixed(2)}</span>
          </div>
        )}
        {/* GDS overlay: colour by Louvain community, size by PageRank importance; cyan-ringed nodes
            are high-betweenness "bridge" concepts. Themes opens the GraphRAG community summaries. */}
        <div className="mt-1.5 flex items-center gap-1 text-[10px]">
          <span className="text-[var(--color-text-tertiary)]">color</span>
          {(['class', 'community'] as const).map((C) => (
            <button key={C} onClick={() => setColorBy(C)}
              className={`rounded-full border px-2 py-0.5 capitalize transition ${colorBy === C ? 'border-[#1d4ed8] text-[#1d4ed8]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>{C}</button>
          ))}
          <span className="ml-1.5 text-[var(--color-text-tertiary)]">size</span>
          {(['degree', 'importance'] as const).map((S) => (
            <button key={S} onClick={() => setSizeBy(S)}
              className={`rounded-full border px-2 py-0.5 capitalize transition ${sizeBy === S ? 'border-[#1d4ed8] text-[#1d4ed8]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>{S}</button>
          ))}
          <button onClick={() => { setShowThemes((v) => !v); if (!showThemes && communities.length === 0) void loadThemes() }} title="GraphRAG: LLM-summarized themes + ask across everything"
            className={`ml-auto rounded-full border px-2 py-0.5 transition ${showThemes ? 'border-[#7c3aed] text-[#7c3aed]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>
            themes
          </button>
          <button onClick={() => { setShowTimeline((v) => !v); if (!showTimeline && !timeline) void loadTimeline() }} title="How your knowledge grew over time"
            className={`rounded-full border px-2 py-0.5 transition ${showTimeline ? 'border-[#0891b2] text-[#0891b2]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>
            timeline
          </button>
          <button onClick={() => { setShowTools((v) => !v); if (!showTools && anomalies.length === 0 && contradictions.length === 0) void loadTools() }} title="Anomalies, contradictions, entity merges, inferred facts"
            className={`rounded-full border px-2 py-0.5 transition ${showTools ? 'border-[#ef4444] text-[#ef4444]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>
            tools
          </button>
        </div>
        {showTools && (
          <div className="mt-1.5 space-y-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-2">
            {/* NL → Cypher: ask the graph in English, get a query + rows */}
            <div>
              <div className="flex items-center gap-1.5">
                <input value={globalQ} onChange={(e) => setGlobalQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askGraphQuery() }}
                  placeholder="Query the graph in English (→ Cypher)…"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#ef4444]" />
                <button onClick={() => void askGraphQuery()} disabled={nlLoading || !globalQ.trim()} className="shrink-0 rounded-lg bg-[#ef4444] px-2.5 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-50">{nlLoading ? '…' : '⌗ query'}</button>
              </div>
              {nlResult && (
                <div className="mt-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
                  <code className="block whitespace-pre-wrap break-words font-mono text-[9px] text-[#0891b2]">{nlResult.cypher || '(no query)'}</code>
                  {nlResult.error ? <span className="text-[9px] text-[#f59e0b]">{nlResult.error}</span> : (
                    <>
                      <span className="text-[9px] text-[var(--color-text-tertiary)]">{nlResult.count ?? 0} result{nlResult.count === 1 ? '' : 's'}</span>
                      <ul className="mt-0.5 max-h-28 space-y-px overflow-y-auto">
                        {(nlResult.rows ?? []).slice(0, 12).map((r, i) => (
                          <li key={i} className="truncate text-[9px] text-[var(--color-text-secondary)]">{Object.values(r).map((v) => String(v)).join(' · ')}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
            {/* Needs attention: anomalies + contradictions */}
            <div className="flex items-center justify-between border-t border-[var(--color-border-tertiary)] pt-1.5">
              <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">needs attention</span>
              <button onClick={() => void loadTools()} disabled={!!toolsLoading} className="text-[9px] text-[#ef4444] disabled:opacity-50">{toolsLoading ? 'scanning…' : 'refresh'}</button>
            </div>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {anomalies.slice(0, 4).map((a, i) => (
                <div key={`a${i}`} className="text-[9px] leading-snug"><span className="text-[#f59e0b]">⚠ {a.kind}</span> <span className="font-medium text-[var(--color-text-secondary)]">{a.label}</span> <span className="text-[var(--color-text-tertiary)]">— {a.detail}</span></div>
              ))}
              {contradictions.slice(0, 4).map((c, i) => (
                <div key={`c${i}`} className="text-[9px] leading-snug"><span className={c.kind === 'superseded' ? 'text-[#0891b2]' : 'text-[#ef4444]'}>{c.kind === 'superseded' ? '⟳ superseded' : '✗ contested'}</span> <span className="text-[var(--color-text-tertiary)]">{c.kind === 'superseded' && c.current ? `now: ${c.current}` : `${c.claimA} ⟷ ${c.claimB}`}</span></div>
              ))}
              {anomalies.length === 0 && contradictions.length === 0 && !toolsLoading && <p className="text-[9px] text-[var(--color-text-tertiary)]">Nothing flagged.</p>}
            </div>
            {/* Entity resolution + inference */}
            {mergeCands.length > 0 && (
              <div className="border-t border-[var(--color-border-tertiary)] pt-1.5">
                <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">merge candidates ({mergeCands.length})</span>
                {mergeCands.slice(0, 4).map((m, i) => (<div key={i} className="text-[9px] leading-snug text-[var(--color-text-secondary)]">⛙ {m.a} ≈ {m.b} <span className="text-[var(--color-text-tertiary)]">({m.confidence}, {m.reason})</span></div>))}
              </div>
            )}
            {inferred.length > 0 && (
              <div className="border-t border-[var(--color-border-tertiary)] pt-1.5">
                <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">inferred facts ({inferred.length})</span>
                {inferred.slice(0, 4).map((f, i) => (<div key={i} className="text-[9px] leading-snug" title={f.via}><span className="text-[#22d3ee]">⊢{f.verified ? '✓' : ''}</span> <span className="text-[var(--color-text-secondary)]">{f.subject} {f.predicate} {f.object}</span></div>))}
              </div>
            )}
            {/* GAIA ontology census — developmental phases + stewardship abandonment signals (IOES). */}
            {gaia && (gaia.phases.length > 0 || gaia.signals.length > 0) && (
              <div className="border-t border-[var(--color-border-tertiary)] pt-1.5" title="GAIA Ontogenesis Stewardship ontology — concepts classified by developmental phase + abandonment signals">
                <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">🌱 ontogenesis (GAIA)</span>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {gaia.phases.map((p) => (<span key={p.phase} className="rounded-full bg-[#16a34a]/10 px-1.5 py-px text-[9px] text-[#16a34a]">{p.phase} {p.count}</span>))}
                </div>
                {gaia.signals.map((s) => (
                  <div key={s.signal} className="mt-0.5 text-[9px] leading-snug" title={s.examples.join(', ')}><span className="text-[#ef4444]">⚑ {s.signal.replace(/_/g, ' ')}</span> <span className="text-[var(--color-text-tertiary)]">({s.count}) — {s.examples.slice(0, 3).join(', ')}</span></div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Knowledge-health — the verified-stack value in one score (trust + completeness + gaps). */}
        {kHealth && (
          <div className="mt-1.5 flex items-center gap-2" title={kHealth.gaps.length ? `Gaps:\n• ${kHealth.gaps.join('\n• ')}` : 'No gaps detected'}>
            <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">🧠 knowledge health</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border-tertiary)]">
              <div className="h-full rounded-full" style={{ width: `${kHealth.score}%`, background: kHealth.score >= 75 ? '#16a34a' : kHealth.score >= 50 ? '#0891b2' : '#f59e0b' }} />
            </div>
            <span className="text-[10px] font-semibold" style={{ color: kHealth.score >= 75 ? '#16a34a' : kHealth.score >= 50 ? '#0891b2' : '#f59e0b' }}>{kHealth.score}</span>
            {kHealth.gaps.length > 0 && <span className="text-[9px] text-[var(--color-text-tertiary)]">· {kHealth.gaps.length} gap{kHealth.gaps.length === 1 ? '' : 's'}</span>}
          </div>
        )}
        {/* Proactive insight — the graph surfaces what needs attention, unprompted (the #1 PKM ask). */}
        {!digestDismissed && digest.length > 0 && digest[digestIdx] && (
          <div className={`mt-1.5 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] leading-snug ${digest[digestIdx]!.severity === 'high' ? 'border-[#f59e0b]/50 bg-[#f59e0b]/5' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]'}`}>
            <span className="shrink-0">{digest[digestIdx]!.icon}</span>
            <span className="flex-1 text-[var(--color-text-secondary)]">{digest[digestIdx]!.message}</span>
            {digest.length > 1 && <button onClick={() => setDigestIdx((i) => (i + 1) % digest.length)} title="Next insight" className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">→</button>}
            <button onClick={() => setDigestDismissed(true)} title="Dismiss" className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">✕</button>
          </div>
        )}
        {/* GDS insights readout — the analytics that drive node size/colour, made legible. */}
        {insights && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-[var(--color-text-tertiary)]">
            <span title="Most important concepts (PageRank)">★ <span className="text-[var(--color-text-secondary)]">{insights.topImportant.join(', ') || '—'}</span></span>
            {insights.topBridges.length > 0 && <span title="Bridge concepts (high betweenness)">· 🌉 <span className="text-[#0891b2]">{insights.topBridges.join(', ')}</span></span>}
            <span title="Louvain communities + modularity">· {insights.communityCount} communities <span className="opacity-70">(mod {insights.modularity.toFixed(2)})</span></span>
          </div>
        )}
        {showTimeline && (
          <div className="mt-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">knowledge over time {timeline ? `(${timeline.total})` : ''}</span>
              <button onClick={() => void loadTimeline()} disabled={tlLoading} className="text-[9px] text-[#0891b2] disabled:opacity-50">{tlLoading ? 'loading…' : 'refresh'}</button>
            </div>
            {!timeline && !tlLoading && <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">No timeline yet — load the knowledge-growth curve.</p>}
            {timeline && timeline.buckets.length > 0 && (() => {
              const max = Math.max(...timeline.buckets.map((b) => b.cumulative), 1)
              const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              const sel = tlSel != null ? timeline.buckets[tlSel] : null
              return (
                <>
                  {/* cumulative growth — bar height ∝ total concepts known by then; click a period to inspect */}
                  <div className="mt-2 flex h-16 items-end gap-0.5">
                    {timeline.buckets.map((b, i) => (
                      <button key={i} onClick={() => setTlSel(i === tlSel ? null : i)} title={`${fmt(b.start)} · +${b.newNodes} (cum ${b.cumulative})`}
                        className="flex-1 rounded-t transition hover:opacity-80"
                        style={{ height: `${Math.max(3, (b.cumulative / max) * 100)}%`, background: i === tlSel ? '#0891b2' : (b.newNodes > 0 ? 'var(--color-border-secondary)' : 'var(--color-border-tertiary)') }} />
                    ))}
                  </div>
                  <div className="mt-0.5 flex justify-between text-[8px] text-[var(--color-text-tertiary)]"><span>{fmt(timeline.from)}</span><span>{fmt(timeline.to)}</span></div>
                  {sel && (
                    <div className="mt-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold text-[var(--color-text-primary)]">{fmt(sel.start)} → {fmt(sel.end)}</span>
                        <span className="text-[9px] text-[var(--color-text-tertiary)]">+{sel.newNodes} new · {sel.cumulative} known</span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-text-secondary)]">{sel.newConcepts.join(' · ') || 'no new concepts in this period'}</p>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}
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

      {showThemes && (
        <div className="border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2.5">
          {/* GraphRAG global sensemaking: a question answered by map-reduce over community summaries. */}
          <div className="flex items-center gap-1.5">
            <input value={globalQ} onChange={(e) => setGlobalQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askGlobal() }}
              placeholder="Ask across everything you know…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
            <button onClick={() => setDeepMode((v) => !v)} title="DRIFT: iterative follow-up reasoning (deeper, slower)"
              className={`shrink-0 rounded-lg border px-2 py-1.5 text-[10px] transition ${deepMode ? 'border-[#7c3aed] text-[#7c3aed]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]'}`}>⟳ deep</button>
            <button onClick={() => void askGlobal()} disabled={globalLoading || !globalQ.trim()}
              className="shrink-0 rounded-lg bg-[#7c3aed] px-2.5 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-50">
              {globalLoading ? '…' : 'Ask'}
            </button>
          </div>
          {globalAnswer && (
            <div className="mt-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
              <p className="whitespace-pre-wrap">{globalAnswer.answer}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px]">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${globalAnswer.grounded ? 'bg-[#16a34a]/15 text-[#16a34a]' : 'bg-[#f59e0b]/15 text-[#f59e0b]'}`}>
                  {globalAnswer.grounded ? '✓' : '⚠'} trust {globalAnswer.trust.toFixed(2)}
                </span>
                {globalAnswer.mode === 'drift' && <span className="rounded-full bg-[#7c3aed]/15 px-1.5 py-0.5 font-semibold text-[#7c3aed]">⟳ drift</span>}
                {!!globalAnswer.localUsed && <span className="rounded-full bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[var(--color-text-tertiary)]">global+{globalAnswer.localUsed} local</span>}
                {globalAnswer.communitiesUsed.map((c, i) => (
                  <span key={i} className="rounded-full bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[var(--color-text-tertiary)]">{c.title}</span>
                ))}
              </div>
              {globalAnswer.followups && globalAnswer.followups.length > 0 && (
                <div className="mt-1 text-[9px] italic text-[var(--color-text-tertiary)]">↳ explored: {globalAnswer.followups.join(' · ')}</div>
              )}
              {globalAnswer.sources && globalAnswer.sources.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-[var(--color-text-tertiary)]">
                  <span>📎 sources:</span>{globalAnswer.sources.map((s, i) => <span key={i} className="rounded bg-[var(--color-background-secondary)] px-1 py-px font-mono">{s}</span>)}
                </div>
              )}
            </div>
          )}
          {/* Community themes — one LLM report per Louvain community, each grounding-trust scored. */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">themes {communities.length ? `(${communities.length})` : ''}</span>
            <button onClick={() => void loadThemes()} disabled={themesLoading} className="text-[9px] text-[#7c3aed] disabled:opacity-50">{themesLoading ? 'summarizing…' : 'refresh'}</button>
          </div>
          <div className="mt-1 max-h-44 space-y-1.5 overflow-y-auto">
            {communities.length === 0 && !themesLoading && <p className="text-[10px] text-[var(--color-text-tertiary)]">No themes yet — refresh to summarize communities.</p>}
            {communities.map((c) => (
              <div key={c.id} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-[var(--color-text-primary)]">{c.title}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${c.grounded ? 'bg-[#16a34a]/15 text-[#16a34a]' : 'bg-[#f59e0b]/15 text-[#f59e0b]'}`}>{c.grounded ? '✓' : '⚠'} {c.trust.toFixed(2)}</span>
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-text-secondary)]">{c.summary}</p>
                <p className="mt-0.5 truncate text-[9px] text-[var(--color-text-tertiary)]">{c.topNodes.join(' · ')}</p>
                {c.claims && c.claims.length > 0 && (
                  <ul className="mt-1 space-y-0.5 border-t border-[var(--color-border-tertiary)] pt-1">
                    {c.claims.map((cl, k) => (
                      <li key={k} className="flex items-start gap-1 text-[9px] leading-snug">
                        <span className={cl.grounded ? 'text-[#16a34a]' : 'text-[#f59e0b]'}>{cl.grounded ? '✓' : '✗'}</span>
                        <span className={cl.grounded ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)] line-through opacity-70'}>{cl.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {/* Predicted connections — structural link prediction (Adamic-Adar), each model-verified. */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">predicted links {predictions.length ? `(${predictions.filter((p) => p.verified).length}✓/${predictions.length})` : ''}</span>
            <button onClick={() => void loadPredictions()} disabled={predLoading} className="text-[9px] text-[#22d3ee] disabled:opacity-50">{predLoading ? 'verifying…' : 'predict'}</button>
          </div>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
            {predictions.length === 0 && !predLoading && <p className="text-[10px] text-[var(--color-text-tertiary)]">No predictions yet — propose + verify likely-missing edges.</p>}
            {predictions.map((p, i) => (
              <div key={i} className={`rounded-lg border px-2.5 py-1.5 ${p.verified ? 'border-[#16a34a]/40' : 'border-[var(--color-border-tertiary)] opacity-60'}`}>
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">{p.sourceLabel} <span className="text-[var(--color-text-tertiary)]">{p.relation ? `— ${p.relation} —` : '~'}</span> {p.targetLabel}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${p.verified ? 'bg-[#16a34a]/15 text-[#16a34a]' : 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'}`}>{p.verified ? `✓ ${p.confidence ?? ''}` : '✗'}</span>
                </div>
                {p.rationale && <p className="mt-0.5 text-[9px] leading-snug text-[var(--color-text-tertiary)]">{p.rationale}</p>}
              </div>
            ))}
          </div>
          {/* Verified covariates — typed claims per entity, each grounding-checked. Header shows the
              auto-detected domain (prompt tuning). */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="truncate text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">covariates {covariates.length ? `(${covariates.reduce((s, e) => s + e.grounded, 0)}✓)` : ''}{domain ? ` · ${domain.domain}` : ''}</span>
            <button onClick={() => { setShowCov((v) => !v); if (!showCov && covariates.length === 0) void loadCovariates() }} disabled={covLoading} className="shrink-0 text-[9px] text-[#0891b2] disabled:opacity-50">{covLoading ? 'extracting…' : (showCov ? 'hide' : 'extract')}</button>
          </div>
          {showCov && (
            <div className="mt-1 max-h-44 space-y-1.5 overflow-y-auto">
              {covariates.length === 0 && !covLoading && <p className="text-[10px] text-[var(--color-text-tertiary)]">No covariates yet — extract typed verified claims per entity.</p>}
              {covariates.map((e, i) => (
                <div key={i} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
                  <div className="truncate text-[11px] font-semibold text-[var(--color-text-primary)]">◆ {e.entity}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {e.covariates.map((c, k) => (
                      <li key={k} className="flex items-start gap-1 text-[9px] leading-snug">
                        <span className={c.grounded ? 'text-[#16a34a]' : 'text-[#f59e0b]'}>{c.grounded ? '✓' : '✗'}</span>
                        <span className={c.grounded ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)] line-through opacity-70'}><span className="text-[var(--color-text-tertiary)]">[{c.type}]</span> {c.claim}{c.object ? <span className="text-[#0891b2]"> → {c.object}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {graph.nodes.length > 0 ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            <SurfaceGraph nodes={graph.nodes} links={graph.links} fill onNodeClick={handleNodeClick} layout={layout} pathIds={pathIds}
              visibleKinds={hiddenKinds.size ? new Set(graph.nodes.map((n) => n.kind ?? 'Concept').filter((k) => !hiddenKinds.has(k))) : undefined}
              hideInferred={hideInferred} colorBy={colorBy} sizeBy={sizeBy} metrics={metrics} onSvgMount={onSvgMount} />
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
                  {impact && impact.totalAffected > 0 && (
                    <div className="mt-0.5 text-[9px] text-[var(--color-text-tertiary)]" title={impact.levels.map((l) => `${l.distance} hop: ${l.count}`).join(' · ')}>
                      💥 impact: <span className="text-[var(--color-text-secondary)]">{impact.totalAffected}</span> affected{impact.levels[0] ? ` (${impact.levels[0].count} direct)` : ''}
                    </div>
                  )}
                  {recs.length > 0 && (
                    <div className="mt-1 border-t border-[var(--color-border-secondary)] pt-1">
                      <span className="text-[8px] uppercase tracking-wide text-[var(--color-text-tertiary)]">explore next</span>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {recs.slice(0, 6).map((r) => (
                          <button key={r.id} onClick={() => setRoot(r.id)} title={r.reasons.join(' · ')}
                            className={`rounded-full border px-1.5 py-0.5 text-[9px] transition hover:border-[#7c3aed] hover:text-[#7c3aed] ${r.connected ? 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]' : 'border-dashed border-[#22d3ee]/50 text-[var(--color-text-tertiary)]'}`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {mem && (
                    <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--color-border-secondary)] pt-1">
                      <span className="truncate text-[9px] text-[var(--color-text-tertiary)]">({mem.kind}) {mem.preview}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => void togglePin(root, !mem.pinned)}
                          className={`rounded-full px-2 py-0.5 text-[9px] font-semibold transition ${mem.pinned ? 'bg-[#7c3aed] text-white' : 'border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:border-[#7c3aed] hover:text-[#7c3aed]'}`}>
                          {mem.pinned ? '📌 Pinned' : 'Pin to brain'}
                        </button>
                        <button onClick={() => void forgetMem(root)} title="Forget this memory"
                          className="rounded-full border border-[var(--color-border-secondary)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)] transition hover:border-[#ef4444] hover:text-[#ef4444]">
                          Forget
                        </button>
                      </div>
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
              hideInferred={hideInferred} colorBy={colorBy} sizeBy={sizeBy} metrics={metrics} onSvgMount={onSvgMount} />
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

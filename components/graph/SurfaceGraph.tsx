'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'

// Palette ported from SocioProphet's surface-graph-shared.js
const COLOR: Record<string, string> = {
  deployment: '#1d4ed8',
  technical: '#7c3aed',
  trust: '#0f766e',
  governance: '#0f766e',
  learning: '#2563eb',
  docs: '#0f172a',
  other: '#64748b',
}

// Entity-CLASS palette (regis kinds) — what a node IS. Drives node colour + the legend/filter.
export const KIND_COLOR: Record<string, string> = {
  Concept:  '#7c3aed',
  Action:   '#ea580c',
  Document: '#0ea5e9',
  Code:     '#2563eb',
  Service:  '#0f766e',
  Session:  '#f59e0b',
  Person:   '#db2777',
  Org:      '#9333ea',
  Entity:   '#16a34a',
  Cluster:  '#e11d48',
}
export const KIND_ORDER = ['Concept', 'Service', 'Code', 'Document', 'Session', 'Entity', 'Person', 'Org', 'Action', 'Cluster']

// Louvain-community palette — distinct hues, cycled, used when colouring nodes by community (GDS).
export const COMMUNITY_COLORS = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#ca8a04', '#dc2626', '#0f766e', '#7c3aed', '#c026d3', '#65a30d']
export function communityColor(c: number | undefined): string { return c === undefined || c < 0 ? '#64748b' : COMMUNITY_COLORS[c % COMMUNITY_COLORS.length]! }
// Per-node GDS metrics overlaid on the surface (from /api/graph/analytics), keyed by node id.
export type NodeMetric = { pagerank: number; betweenness: number; community: number }

// Edge colour by CSKG semantic dimension — the graph reads as a relationship map, not a hairball.
export const DIM_COLOR: Record<string, string> = {
  taxonomic: '#3b82f6', 'part-whole': '#8b5cf6', causation: '#ef4444', temporal: '#06b6d4',
  spatial: '#10b981', similarity: '#ec4899', creation: '#22c55e', utility: '#0ea5e9',
  social: '#d946ef', 'co-occurrence': '#94a3b8', distinctness: '#6366f1', desire: '#eab308',
  quality: '#84cc16', functional: '#cbd5e1',
}
export const DIM_ORDER = ['taxonomic', 'part-whole', 'causation', 'temporal', 'similarity', 'creation', 'utility', 'social', 'co-occurrence']

export interface GraphNode {
  id: string; label: string; category: string; kind?: string; featured?: boolean; degree?: number
  x0?: number; y0?: number
  /** Node has been verified + grounded by the knowledge canon — renders a canon-ring badge. */
  grounded?: boolean
}
export interface GraphLink { source: string; target: string; primary?: boolean; epistemic?: string; dimension?: string }

// Disemvowel a label so the whole concept fits in/under a small node — like a DB column
// abbreviation (customer_data → custmr_dta): keep the first 1–2 chars + last char of each
// word, drop interior vowels. Recognizable at a glance without truncating to "self n…".
function squeezeWord(w: string): string {
  // Only abbreviate genuinely long words — squeezing short ones (hellgraph→hellgrph,
  // retrieval→retrvl, primary→prmry) made real words read as misspellings. Keep ≤10 intact.
  if (w.length <= 10) return w
  const head = w.slice(0, 3), last = w[w.length - 1]!
  const mid = w.slice(3, -1).replace(/[aeiou]/gi, '')
  return head + mid + last
}
function squeeze(label: string): string {
  return label.split(/([\s_-]+)/).map((p) => (/^[\s_-]+$/.test(p) ? p : squeezeWord(p))).join('')
}

interface Sim extends GraphNode { x: number; y: number; vx: number; vy: number; r: number; fx?: number | null; fy?: number | null }

/**
 * SurfaceGraph — a force-directed graph view (faithful port of SocioProphet's D3
 * surface graph) with a self-contained simulation, so it needs no d3 dependency.
 * Charge repulsion + link springs + anchor/centering + collision, SVG-rendered,
 * draggable. Feed it nodes/links from /api/graph/surface.
 */
export type GraphLayout = 'force' | 'radial' | 'hierarchy'

export function SurfaceGraph({ nodes, links, width, height, fill, onNodeClick, visibleKinds, hideInferred, layout = 'force', pathIds, colorBy = 'class', sizeBy = 'degree', metrics, onSvgMount }: {
  nodes: GraphNode[]; links: GraphLink[]; width?: number; height?: number; fill?: boolean; onNodeClick?: (id: string) => void
  visibleKinds?: Set<string>; hideInferred?: boolean; layout?: GraphLayout; pathIds?: string[]
  colorBy?: 'class' | 'community'; sizeBy?: 'importance' | 'degree'; metrics?: Record<string, NodeMetric>
  /** Called with the SVG element when mounted, null on unmount — lets the parent export the graph. */
  onSvgMount?: (el: SVGSVGElement | null) => void
}) {
  // Faceted filtering: hide whole entity classes, and/or hide low-trust (inferred) edges.
  const fNodes = useMemo(() => (visibleKinds ? nodes.filter((n) => visibleKinds.has(n.kind ?? 'Concept')) : nodes), [nodes, visibleKinds])
  const fIds = useMemo(() => new Set(fNodes.map((n) => n.id)), [fNodes])
  const fLinks = useMemo(() => links.filter((l) => fIds.has(l.source) && fIds.has(l.target) && (!hideInferred || l.epistemic !== 'inferred')), [links, fIds, hideInferred])
  nodes = fNodes; links = fLinks
  // In `fill` mode, measure the container and use the FULL available space as the
  // simulation canvas (so the graph expands to fill the panel instead of a fixed box).
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: width ?? 760, h: height ?? 460 })
  useEffect(() => {
    if (!fill || !wrapRef.current) return
    const el = wrapRef.current
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 40 && r.height > 40) setDims({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])
  const W = fill ? dims.w : (width ?? 760)
  const H = fill ? dims.h : (height ?? 460)
  const [, setTick] = useState(0)
  const simRef = useRef<Sim[]>([])
  const dragRef = useRef<{ id: string } | null>(null)
  const movedRef = useRef(false)   // did this pointer-down become a real drag (vs a tap)?
  // Zoom + pan: the viewBox is computed from {x,y,k}. Wheel zooms toward the cursor; dragging empty space pans.
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
  const rafRef = useRef<number>(0)
  const alphaRef = useRef(1)
  const runningRef = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const ensureRunningRef = useRef<() => void>(() => {})

  // Expose the SVG element to the parent for export (PNG/SVG download).
  useEffect(() => {
    onSvgMount?.(svgRef.current)
    return () => { onSvgMount?.(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Layout seeding: radial = BFS-distance rings from the most-central node; hierarchy = top-down
  // BFS layers; force = no anchor (organic). The anchor force then holds nodes near these seeds.
  const seed = useMemo<Map<string, { x0: number; y0: number }> | null>(() => {
    if (layout === 'force') return null
    const adj = new Map<string, string[]>()
    const deg = new Map<string, number>()
    for (const l of links) {
      ;(adj.get(l.source) ?? adj.set(l.source, []).get(l.source)!).push(l.target)
      ;(adj.get(l.target) ?? adj.set(l.target, []).get(l.target)!).push(l.source)
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1); deg.set(l.target, (deg.get(l.target) ?? 0) + 1)
    }
    const center = nodes.slice().sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0))[0]
    const dist = new Map<string, number>()
    if (center) { dist.set(center.id, 0); const q = [center.id]; while (q.length) { const u = q.shift()!; for (const v of adj.get(u) ?? []) if (!dist.has(v)) { dist.set(v, dist.get(u)! + 1); q.push(v) } } }
    const known = [...dist.values()]; const maxD = known.length ? Math.max(...known) : 0
    nodes.forEach((n) => { if (!dist.has(n.id)) dist.set(n.id, maxD + 1) })   // disconnected → outer ring
    const layers = new Map<number, string[]>()
    nodes.forEach((n) => { const d = dist.get(n.id)!; (layers.get(d) ?? layers.set(d, []).get(d)!).push(n.id) })
    const maxLayer = Math.max(1, ...layers.keys())
    const R = Math.min(W, H) * 0.43
    const pos = new Map<string, { x0: number; y0: number }>()
    for (const [d, ids] of layers) ids.forEach((id, i) => {
      if (layout === 'radial') {
        const radius = (d / maxLayer) * R
        const ang = (i / Math.max(1, ids.length)) * Math.PI * 2 + d * 0.6
        pos.set(id, { x0: Math.cos(ang) * radius, y0: Math.sin(ang) * radius })
      } else {
        const y = (d / maxLayer - 0.5) * H * 0.82
        const x = (ids.length > 1 ? i / (ids.length - 1) - 0.5 : 0) * W * 0.82
        pos.set(id, { x0: x, y0: y })
      }
    })
    return pos
  }, [nodes, links, layout, W, H])

  // Build working sim nodes whenever the data changes.
  const built = useMemo(() => {
    const cx = W / 2, cy = H / 2
    return nodes.map<Sim>((n) => {
      const sp = seed?.get(n.id)
      const x0 = sp?.x0 ?? n.x0, y0 = sp?.y0 ?? n.y0
      return {
        ...n, x0, y0,
        r: n.featured ? 17 : 11,
        x: cx + (x0 ?? (Math.random() - 0.5) * Math.min(W, H) * 0.7),
        y: cy + (y0 ?? (Math.random() - 0.5) * Math.min(W, H) * 0.7),
        vx: 0, vy: 0,
      }
    })
  }, [nodes, W, H, seed])

  useEffect(() => {
    simRef.current = built
    const byId = new Map(simRef.current.map((n) => [n.id, n]))
    const L = links.map((l) => ({ ...l, s: byId.get(l.source), t: byId.get(l.target) })).filter((l) => l.s && l.t)
    const cx = W / 2, cy = H / 2
    const decay = 0.0228, velDecay = 0.6
    alphaRef.current = 1

    const step = () => {
      const ns = simRef.current
      const alpha = alphaRef.current
      // charge (many-body repulsion, O(n²) — fine for ≤120). Clamp the close-range
      // distance so the inverse-square force can't explode and fling nodes off-canvas.
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i]!
        for (let j = i + 1; j < ns.length; j++) {
          const b = ns[j]!
          const dx = a.x - b.x, dy = a.y - b.y
          const minD = a.r + b.r
          const d2 = Math.max(dx * dx + dy * dy, minD * minD)
          const charge = a.featured || b.featured ? 4400 : 2900
          const dist = Math.sqrt(d2)
          const f = Math.min((charge * alpha) / d2, 90)   // cap per-pair impulse
          a.vx += (dx / dist) * f; a.vy += (dy / dist) * f
          b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f
        }
      }
      // links (springs)
      for (const l of L) {
        const s = l.s!, t = l.t!
        const dx = t.x - s.x, dy = t.y - s.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const target = l.primary ? 200 : 150
        const k = (l.primary ? 1 : 0.55) * alpha
        const f = ((dist - target) / dist) * k * 0.5
        s.vx += dx * f; s.vy += dy * f
        t.vx -= dx * f; t.vy -= dy * f
      }
      // anchor to seed (x0,y0) + gentle centering
      for (const n of ns) {
        if (n.x0 != null) n.vx += (cx + n.x0 - n.x) * 0.16 * alpha
        if (n.y0 != null) n.vy += (cy + n.y0 - n.y) * 0.16 * alpha
        n.vx += (cx - n.x) * 0.011 * alpha
        n.vy += (cy - n.y) * 0.011 * alpha
      }
      // collision
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i]!, b = ns[j]!
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const min = a.r + b.r + 22
          if (dist < min) {
            const push = ((min - dist) / dist) * 0.5
            a.x -= dx * push; a.y -= dy * push
            b.x += dx * push; b.y += dy * push
          }
        }
      }
      // integrate (pinned nodes follow fx/fy; others damp + move, clamped to canvas)
      for (const n of ns) {
        if (n.fx != null) { n.x = n.fx; n.vx = 0 } else { n.vx *= velDecay; n.x += n.vx }
        if (n.fy != null) { n.y = n.fy; n.vy = 0 } else { n.vy *= velDecay; n.y += n.vy }
        n.x = Math.max(n.r, Math.min(W - n.r, n.x))
        n.y = Math.max(n.r, Math.min(H - n.r, n.y))
      }
      alphaRef.current += (0 - alpha) * decay
      setTick((t) => (t + 1) & 0xffff)
      if (alphaRef.current > 0.005 || dragRef.current) rafRef.current = requestAnimationFrame(step)
      else runningRef.current = false
    }
    const ensureRunning = () => { if (!runningRef.current) { runningRef.current = true; rafRef.current = requestAnimationFrame(step) } }
    ensureRunningRef.current = ensureRunning
    ensureRunning()
    return () => { cancelAnimationFrame(rafRef.current); runningRef.current = false }
  }, [built, links, W, H])

  // Convert a pointer event to viewBox coordinates (the SVG is scaled to its container).
  const toViewBox = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: view.x + ((e.clientX - rect.left) / rect.width) * (W / view.k),
      y: view.y + ((e.clientY - rect.top) / rect.height) * (H / view.k),
    }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      const svg = svgRef.current; if (!svg) return
      const rect = svg.getBoundingClientRect()
      const dx = ((e.clientX - panRef.current.sx) / rect.width) * (W / view.k)
      const dy = ((e.clientY - panRef.current.sy) / rect.height) * (H / view.k)
      setView((v) => ({ ...v, x: panRef.current!.vx - dx, y: panRef.current!.vy - dy }))
      return
    }
    if (!dragRef.current) return
    movedRef.current = true
    const n = simRef.current.find((m) => m.id === dragRef.current!.id)
    if (n) { const p = toViewBox(e); n.fx = p.x; n.fy = p.y; alphaRef.current = Math.max(alphaRef.current, 0.15); ensureRunningRef.current() }
  }
  // Wheel zoom toward the cursor (keeps the point under the pointer fixed). Clamped 0.4×–6×.
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current; if (!svg) return
    const rect = svg.getBoundingClientRect()
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height
    setView((v) => {
      const k = Math.min(6, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const cx = v.x + fx * (W / v.k), cy = v.y + fy * (H / v.k)
      return { k, x: cx - fx * (W / k), y: cy - fy * (H / k) }
    })
  }
  // Start a pan when the press lands on empty canvas (a node press sets dragRef first, via bubbling).
  const onBgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) return
    panRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
  }
  // A real drag PINS the node where you drop it (fx/fy kept) — so pulling a cluster apart makes it
  // STAY apart instead of springing back; you keep control of the layout. A tap (no movement) is a
  // drill, not a drag. Double-click empty space to release every pin and let it reflow.
  const endDrag = () => {
    panRef.current = null
    if (dragRef.current && !movedRef.current) onNodeClick?.(dragRef.current.id)
    dragRef.current = null
    movedRef.current = false
  }
  const releaseAll = () => {
    for (const n of simRef.current) { n.fx = null; n.fy = null }
    setView({ x: 0, y: 0, k: 1 })   // double-click empty also resets zoom/pan to fit
    alphaRef.current = 1
    ensureRunningRef.current()
  }

  const ns = simRef.current
  const byId = new Map(ns.map((n) => [n.id, n]))
  // Path highlight: the shortest-path chain glows gold (nodes + the edges between consecutive hops).
  const pathSet = new Set(pathIds ?? [])
  const pathEdge = new Set<string>()
  for (let i = 0; pathIds && i + 1 < pathIds.length; i++) { pathEdge.add(`${pathIds[i]}|${pathIds[i + 1]}`); pathEdge.add(`${pathIds[i + 1]}|${pathIds[i]}`) }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: fill ? '100%' : 'auto' }}>
    <svg ref={svgRef} width={W} height={H} viewBox={`${view.x} ${view.y} ${W / view.k} ${H / view.k}`} style={{ width: '100%', height: fill ? '100%' : 'auto', display: 'block', fontFamily: 'Inter, sans-serif', touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'default' }}
      onWheel={onWheel} onPointerDown={onBgPointerDown} onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag} onDoubleClick={releaseAll}>
      <defs>
        <filter id="spNodeGlow">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g stroke="#cbd5e1" strokeOpacity={0.95}>
        {links.map((l, i) => {
          const s = byId.get(l.source), t = byId.get(l.target)
          if (!s || !t) return null
          // Inferred (algorithm-derived) edges read as dashed + faint; extracted/confirmed as solid —
          // so you can SEE which links to trust and filter the guesses out.
          const inferred = l.epistemic === 'inferred'
          const onPath = pathEdge.has(`${l.source}|${l.target}`)
          if (onPath) return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#f59e0b" strokeWidth={4} strokeOpacity={1} />
          const dimColor = DIM_COLOR[l.dimension ?? 'functional'] ?? '#cbd5e1'
          return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={dimColor} strokeWidth={l.primary ? 2.5 : 1.4} strokeDasharray={inferred ? '5 4' : undefined} strokeOpacity={inferred ? 0.45 : 0.8} />
        })}
      </g>
      {ns.map((n) => {
        // GDS overlay: size by PageRank importance (sqrt-scaled to spread small values), colour by
        // Louvain community, and ring "bridge" concepts (high betweenness) — when metrics are present.
        const m = metrics?.[n.id]
        const dr = sizeBy === 'importance' && m ? 9 + Math.sqrt(Math.max(0, m.pagerank)) * 22 : n.r
        const nodeFill = colorBy === 'community' && m ? communityColor(m.community) : (KIND_COLOR[n.kind ?? ''] ?? COLOR[n.category] ?? COLOR.other)
        const isBridge = !!m && m.betweenness >= 0.4
        return (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} cursor="grab"
          onPointerDown={(e) => { dragRef.current = { id: n.id }; movedRef.current = false; (e.target as Element).setPointerCapture?.(e.pointerId); alphaRef.current = Math.max(alphaRef.current, 0.3); ensureRunningRef.current() }}>
          <title>{n.label}{m ? ` · importance ${m.pagerank.toFixed(2)}${isBridge ? ' · bridge concept' : ''}` : ''}{n.grounded ? ' · canon-grounded' : ''}</title>
          {pathSet.has(n.id) && <circle r={dr + 4} fill="none" stroke="#f59e0b" strokeWidth={2.5} />}
          {isBridge && !pathSet.has(n.id) && <circle r={dr + 4} fill="none" stroke="#22d3ee" strokeWidth={2} strokeDasharray="2 3" strokeOpacity={0.85} />}
          {/* Canon-ring: this concept is grounded in the authored knowledge canon. Solid amber, tight
              so it reads as a "seal" rather than a glow. Stacks outside the bridge ring. */}
          {n.grounded && <circle r={dr + (isBridge ? 8 : 4)} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeOpacity={0.9} />}
          <circle r={dr} fill={nodeFill} stroke="#fff" strokeWidth={n.featured ? 3 : 2} filter="url(#spNodeGlow)" />
          {/* readable label BELOW the node: featured hubs show the full concept, others the
              disemvowelled form so the whole word is recognizable (no "self n…" truncation). */}
          <text textAnchor="middle" dy={dr + 11} fontSize={n.featured ? 11 : 9.5} fontWeight={n.featured ? 700 : 600}
            fill={n.featured ? 'var(--color-text-primary, #e5e7eb)' : 'var(--color-text-secondary, #94a3b8)'}
            stroke="rgba(0,0,0,0.55)" strokeWidth={3} paintOrder="stroke" pointerEvents="none">
            {n.featured ? (n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label) : squeeze(n.label)}
          </text>
        </g>
        )
      })}
    </svg>
    </div>
  )
}

export default SurfaceGraph

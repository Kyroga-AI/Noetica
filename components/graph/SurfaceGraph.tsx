'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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

export interface GraphNode {
  id: string; label: string; category: string; featured?: boolean; degree?: number
  x0?: number; y0?: number
}
export interface GraphLink { source: string; target: string; primary?: boolean }

interface Sim extends GraphNode { x: number; y: number; vx: number; vy: number; r: number; fx?: number | null; fy?: number | null }

/**
 * SurfaceGraph — a force-directed graph view (faithful port of SocioProphet's D3
 * surface graph) with a self-contained simulation, so it needs no d3 dependency.
 * Charge repulsion + link springs + anchor/centering + collision, SVG-rendered,
 * draggable. Feed it nodes/links from /api/graph/surface.
 */
export function SurfaceGraph({ nodes, links, width, height, fill, onNodeClick }: {
  nodes: GraphNode[]; links: GraphLink[]; width?: number; height?: number; fill?: boolean; onNodeClick?: (id: string) => void
}) {
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
  const rafRef = useRef<number>(0)
  const alphaRef = useRef(1)
  const runningRef = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const ensureRunningRef = useRef<() => void>(() => {})

  // Build working sim nodes whenever the data changes.
  const built = useMemo(() => {
    const cx = W / 2, cy = H / 2
    return nodes.map<Sim>((n) => ({
      ...n,
      r: n.featured ? 30 : 21,
      x: cx + (n.x0 ?? (Math.random() - 0.5) * 200),
      y: cy + (n.y0 ?? (Math.random() - 0.5) * 200),
      vx: 0, vy: 0,
    }))
  }, [nodes, W, H])

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
          const charge = a.featured || b.featured ? 1400 : 850
          const dist = Math.sqrt(d2)
          const f = Math.min((charge * alpha) / d2, 40)   // cap per-pair impulse
          a.vx += (dx / dist) * f; a.vy += (dy / dist) * f
          b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f
        }
      }
      // links (springs)
      for (const l of L) {
        const s = l.s!, t = l.t!
        const dx = t.x - s.x, dy = t.y - s.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const target = l.primary ? 128 : 92
        const k = (l.primary ? 1 : 0.55) * alpha
        const f = ((dist - target) / dist) * k * 0.5
        s.vx += dx * f; s.vy += dy * f
        t.vx -= dx * f; t.vy -= dy * f
      }
      // anchor to seed (x0,y0) + gentle centering
      for (const n of ns) {
        if (n.x0 != null) n.vx += (cx + n.x0 - n.x) * 0.16 * alpha
        if (n.y0 != null) n.vy += (cy + n.y0 - n.y) * 0.16 * alpha
        n.vx += (cx - n.x) * 0.02 * alpha
        n.vy += (cy - n.y) * 0.02 * alpha
      }
      // collision
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i]!, b = ns[j]!
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const min = a.r + b.r + 8
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
  const toViewBox = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    const n = simRef.current.find((m) => m.id === dragRef.current!.id)
    if (n) { const p = toViewBox(e); n.fx = p.x; n.fy = p.y; alphaRef.current = Math.max(alphaRef.current, 0.15); ensureRunningRef.current() }
  }
  const endDrag = () => {
    if (dragRef.current) { const n = simRef.current.find((m) => m.id === dragRef.current!.id); if (n) { n.fx = null; n.fy = null } }
    dragRef.current = null
  }

  const ns = simRef.current
  const byId = new Map(ns.map((n) => [n.id, n]))

  return (
    <div ref={wrapRef} style={{ width: '100%', height: fill ? '100%' : 'auto' }}>
    <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: fill ? '100%' : 'auto', display: 'block', fontFamily: 'Inter, sans-serif', touchAction: 'none' }}
      onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
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
          return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} strokeWidth={l.primary ? 2.5 : 1.4} />
        })}
      </g>
      {ns.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} cursor={onNodeClick ? 'pointer' : 'grab'}
          onClick={() => onNodeClick?.(n.id)}
          onPointerDown={(e) => { dragRef.current = { id: n.id }; (e.target as Element).setPointerCapture?.(e.pointerId); alphaRef.current = Math.max(alphaRef.current, 0.3); ensureRunningRef.current() }}>
          <title>{n.label}</title>
          <circle r={n.r} fill={COLOR[n.category] ?? COLOR.other} stroke="#fff" strokeWidth={n.featured ? 4 : 3} filter="url(#spNodeGlow)" />
          {/* short label inside the circle; full name on hover via <title> */}
          <text textAnchor="middle" dy={3} fontSize={n.featured ? 11 : 9} fontWeight={700} fill="#fff" pointerEvents="none">
            {n.label.length > (n.featured ? 9 : 7) ? n.label.slice(0, n.featured ? 8 : 6) + '…' : n.label}
          </text>
          {/* full caption below featured hubs for readability */}
          {n.featured && <text textAnchor="middle" dy={n.r + 12} fontSize={9} fontWeight={600} fill="#475569" pointerEvents="none">{n.label.slice(0, 22)}</text>}
        </g>
      ))}
    </svg>
    </div>
  )
}

export default SurfaceGraph

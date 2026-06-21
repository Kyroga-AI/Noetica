'use client'

/**
 * ChartView — a lightweight, dependency-free SVG renderer for the registry's chart types.
 * Renders a `noetica-chart` payload {type, data, x, y, …} in-chat. Local-first, app-native
 * (same SVG approach as SurfaceGraph) — no Vega/D3 bundle.
 */
import { useMemo } from 'react'

export interface ChartSpec {
  type: 'line' | 'bar' | 'area' | 'scatter' | 'pie' | 'histogram'
  data: Record<string, unknown>[]
  x?: string
  y?: string
  category?: string
  value?: string
  title?: string
}

const COLORS = ['#1d4ed8', '#7c3aed', '#0f766e', '#dc2626', '#ea580c', '#0891b2', '#65a30d', '#c026d3']
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : 0 }

export function ChartView({ spec }: { spec: ChartSpec }) {
  const W = 580, H = 300, P = { t: 30, r: 18, b: 42, l: 52 }
  const iw = W - P.l - P.r, ih = H - P.t - P.b

  const body = useMemo(() => {
    const data = Array.isArray(spec.data) ? spec.data : []
    if (!data.length) return null
    const axis = (
      <>
        <line x1={P.l} y1={P.t + ih} x2={P.l + iw} y2={P.t + ih} stroke="var(--color-border-secondary,#475569)" strokeWidth={1} />
        <line x1={P.l} y1={P.t} x2={P.l} y2={P.t + ih} stroke="var(--color-border-secondary,#475569)" strokeWidth={1} />
      </>
    )

    // ── Pie ──
    if (spec.type === 'pie') {
      const cat = spec.category ?? spec.x ?? 'label', val = spec.value ?? spec.y ?? 'value'
      const total = data.reduce((s, d) => s + num(d[val]), 0) || 1
      let a0 = -Math.PI / 2
      const cx = W / 2, cy = P.t + ih / 2, r = Math.min(iw, ih) / 2 - 4
      return (
        <>
          {data.map((d, i) => {
            const frac = num(d[val]) / total, a1 = a0 + frac * 2 * Math.PI
            const large = a1 - a0 > Math.PI ? 1 : 0
            const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
            const path = `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`
            const mid = (a0 + a1) / 2; a0 = a1
            return (
              <g key={i}>
                <path d={path} fill={COLORS[i % COLORS.length]} opacity={0.9} />
                {frac > 0.05 && <text x={cx + (r * 0.65) * Math.cos(mid)} y={cy + (r * 0.65) * Math.sin(mid)} fontSize={10} fill="#fff" textAnchor="middle" dy={3}>{String(d[cat]).slice(0, 10)}</text>}
              </g>
            )
          })}
        </>
      )
    }

    // ── Cartesian (line/area/scatter/bar/histogram) ──
    const xf = spec.x ?? 'x', yf = spec.y ?? 'y'
    let rows = data
    let yKey = yf
    // histogram: bin x into counts
    if (spec.type === 'histogram') {
      const vals = data.map((d) => num(d[xf])).sort((a, b) => a - b)
      const min = vals[0] ?? 0, max = vals[vals.length - 1] ?? 1, bins = Math.min(12, Math.max(5, Math.round(Math.sqrt(vals.length))))
      const w = (max - min) / bins || 1
      const counts = new Array(bins).fill(0)
      for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++
      rows = counts.map((c, i) => ({ __label: (min + i * w).toFixed(1), __v: c }))
      yKey = '__v'
    }
    const isCat = spec.type === 'bar' || spec.type === 'histogram'
    const labelKey = spec.type === 'histogram' ? '__label' : xf
    const ys = rows.map((d) => num(d[yKey]))
    const ymax = Math.max(1, ...ys), ymin = Math.min(0, ...ys)
    const yScale = (v: number) => P.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih
    const xAt = (i: number) => P.l + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw)
    const barW = (iw / rows.length) * 0.7

    const yticks = [ymin, ymin + (ymax - ymin) / 2, ymax]
    const grid = yticks.map((t, i) => (
      <g key={i}>
        <text x={P.l - 6} y={yScale(t)} fontSize={9} fill="var(--color-text-tertiary,#94a3b8)" textAnchor="end" dy={3}>{t.toFixed(t % 1 ? 1 : 0)}</text>
      </g>
    ))
    const xlabels = rows.map((d, i) => {
      if (rows.length > 8 && i % Math.ceil(rows.length / 8) !== 0) return null
      const cx = isCat ? P.l + (i + 0.5) * (iw / rows.length) : xAt(i)
      return <text key={i} x={cx} y={P.t + ih + 14} fontSize={9} fill="var(--color-text-tertiary,#94a3b8)" textAnchor="middle">{String(d[labelKey]).slice(0, 8)}</text>
    })

    if (spec.type === 'bar' || spec.type === 'histogram') {
      return (<>{axis}{grid}{xlabels}{rows.map((d, i) => {
        const h = P.t + ih - yScale(num(d[yKey]))
        return <rect key={i} x={P.l + i * (iw / rows.length) + (iw / rows.length - barW) / 2} y={yScale(num(d[yKey]))} width={barW} height={Math.max(0, h)} fill={COLORS[0]} rx={2} />
      })}</>)
    }
    const pts = rows.map((d, i) => `${xAt(i).toFixed(1)},${yScale(num(d[yKey])).toFixed(1)}`)
    if (spec.type === 'scatter') {
      return (<>{axis}{grid}{xlabels}{rows.map((d, i) => <circle key={i} cx={xAt(i)} cy={yScale(num(d[yKey]))} r={3.5} fill={COLORS[1]} opacity={0.8} />)}</>)
    }
    return (<>{axis}{grid}{xlabels}
      {spec.type === 'area' && <polygon points={`${P.l},${P.t + ih} ${pts.join(' ')} ${P.l + iw},${P.t + ih}`} fill={COLORS[0]} opacity={0.18} />}
      <polyline points={pts.join(' ')} fill="none" stroke={COLORS[0]} strokeWidth={2} />
      {rows.length <= 30 && rows.map((d, i) => <circle key={i} cx={xAt(i)} cy={yScale(num(d[yKey]))} r={2.5} fill={COLORS[0]} />)}
    </>)
  }, [spec, iw, ih])

  if (!body) return <div className="my-2 text-[12px] text-[var(--color-text-tertiary)]">(no chart data)</div>
  return (
    <figure className="my-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-2">
      {spec.title && <figcaption className="px-1 pb-1 text-[12px] font-semibold text-[var(--color-text-primary)]">{spec.title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', fontFamily: 'Inter, sans-serif' }}>{body}</svg>
    </figure>
  )
}

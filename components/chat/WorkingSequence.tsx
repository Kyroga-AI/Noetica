'use client'

import { useEffect, useRef } from 'react'

/**
 * WorkingSequence — the "model is working" indicator.
 *
 * Two phases, one clock:
 *   1. Polygons — a point grows to a line, a triangle, a square … up to an octagon. One new side
 *      per beat, always inscribed in the same circle so the footprint never changes.
 *   2. Twists — a polygon stops being legible once it's ~8 sides (nonagon, decagon … all read as a
 *      circle). So at that point the loop instead starts to *twist*: a woven Möbius-like braid that
 *      gains one crossing per beat, staying countable and distinct however long the model runs.
 *
 * The result still reads as a clock — more sides, then more twists, means more elapsed time — and
 * it stays deliberately monochrome and minimal: just points and lines in `currentColor`.
 * Replaces the old Hopf-fibration loader.
 */
export function WorkingSequence({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 3)   // headroom so the small loader stays crisp on retina
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const color = getComputedStyle(canvas).color || '#888'      // lines stay monochrome (the text color)
    const BEADS = ['#6c9ef0', '#eb9ec6', '#9aa1ab']             // the points: a quiet blue · pink · grey rhythm
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const cx = size / 2
    const cy = size / 2
    const R = size * 0.34                 // one radius for every N-gon → constant footprint
    const dotR = Math.max(0.7, size * 0.05)   // floors kept low so geometry scales cleanly at small sizes
    const edgeW = Math.max(0.6, size * 0.032)
    const weave = size * 0.085            // twist amplitude (rail excursion in the braid phase)

    const STEP = 1100                     // ms per step — the beat of the clock
    const HOLD = 0.68                     // fraction of each step the figure holds before morphing
    const ROT = 0.00022                   // rad/ms — a slow drift so it breathes
    const POLY_MAX = 8                    // last polygon (octagon); beyond this, polygons blur → twist instead
    const TWIST_MAX = 24                  // cap the braid density
    const TAU = Math.PI * 2
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
    const at = (a: number): [number, number] => [cx + R * Math.cos(a), cy + R * Math.sin(a)]

    // ── Phase 1: an n-gon, optionally easing toward the (n+1)-gon, at global alpha g ──────────────
    const drawPolygon = (n: number, morph: number, base: number, g: number) => {
      const count = morph > 0 ? n + 1 : n
      const ang: number[] = []
      for (let i = 0; i < n; i++) {
        const from = (i * TAU) / n
        const to = (i * TAU) / (n + 1)
        ang.push(base + from + (to - from) * morph)
      }
      if (morph > 0) ang.push(base + (n * TAU) / (n + 1))

      ctx.strokeStyle = color
      ctx.lineWidth = edgeW
      const edge = (i: number, j: number, alpha: number) => {
        if (alpha <= 0) return
        const a = at(ang[i]!), b = at(ang[j]!)
        ctx.globalAlpha = alpha * g
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
      }
      if (count >= 2) {
        const closes = count >= 3
        for (let i = 0; i < count; i++) {
          if (!closes && i === count - 1) break
          const j = (i + 1) % count
          const touchesNew = morph > 0 && (i === n || j === n)
          edge(i, j, touchesNew ? morph : 1)
        }
        if (morph > 0 && n >= 3) edge(n - 1, 0, 1 - morph)     // old closing edge fades out
      }

      for (let i = 0; i < count; i++) {
        const isNew = morph > 0 && i === n
        const a = at(ang[i]!)
        ctx.fillStyle = BEADS[i % BEADS.length]!             // beads cycle blue · pink · grey
        ctx.globalAlpha = (isNew ? morph : 1) * g
        ctx.beginPath(); ctx.arc(a[0], a[1], isNew ? dotR * morph : dotR, 0, TAU); ctx.fill()
      }
    }

    // ── Phase 2: a woven loop with `twists` crossings — two rails that weave around the ring ──────
    const drawBraid = (twists: number, base: number, g: number) => {
      const T = Math.min(TWIST_MAX, twists)
      const SEG = 132
      ctx.strokeStyle = color
      ctx.lineWidth = edgeW
      ctx.globalAlpha = g
      for (const sign of [1, -1]) {                 // the two rails, offset by π so they cross 2·T times
        ctx.beginPath()
        for (let k = 0; k <= SEG; k++) {
          const th = (k / SEG) * TAU
          const rad = R + sign * weave * Math.cos(T * th)
          const x = cx + rad * Math.cos(th + base)
          const y = cy + rad * Math.sin(th + base)
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      // a bead at each of the T outer lobes — keeps the "points" motif and makes the twist countable
      for (let j = 0; j < T; j++) {
        const th = (j / T) * TAU
        const rad = R + weave
        ctx.fillStyle = BEADS[j % BEADS.length]!            // beads cycle blue · pink · grey
        ctx.beginPath()
        ctx.arc(cx + rad * Math.cos(th + base), cy + rad * Math.sin(th + base), dotR, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const t = now - start
      const stepF = t / STEP
      const b = Math.floor(stepF)                                  // 0-indexed beat
      const frac = stepF - b
      const morph = reduce ? 0 : smooth((frac - HOLD) / (1 - HOLD))
      const base = -Math.PI / 2 + (reduce ? 0 : t * ROT)           // vertex 0 starts at the top

      ctx.clearRect(0, 0, size, size)

      if (b < POLY_MAX - 1) {
        // polygon beats: N = b+1 (a point at b=0), easing toward N+1
        drawPolygon(b + 1, morph, base, 1)
      } else if (b === POLY_MAX - 1) {
        // last polygon (octagon) → hand off to the first twist
        if (morph <= 0) drawPolygon(POLY_MAX, 0, base, 1)
        else { drawPolygon(POLY_MAX, 0, base, 1 - morph); drawBraid(1, base, morph) }
      } else {
        // twist phase: T grows by one per beat, crossfading to the next
        const T = b - POLY_MAX + 1
        if (morph <= 0) drawBraid(T, base, 1)
        else { drawBraid(T, base, 1 - morph); drawBraid(T + 1, base, morph) }
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return (
    <span className="inline-flex shrink-0" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden />
    </span>
  )
}

'use client'

import { useEffect, useRef } from 'react'

// What the agent is doing — drives the fibration's color so the loader *means*
// something. Wire more states in as they're surfaced (a running tool, research, etc.).
export type HopfState = 'thinking' | 'tool' | 'research' | 'writing' | 'idle'

const PALETTES: Record<HopfState, (phi: number) => string> = {
  thinking: (phi) => `hsl(${(phi / (2 * Math.PI)) * 360}, 85%, 62%)`,
  tool:     (phi) => `hsl(${195 + 45 * Math.sin(phi)}, 85%, 62%)`,
  research: (phi) => `hsl(${120 + 55 * Math.sin(phi)}, 70%, 56%)`,
  writing:  (phi) => `hsl(${25 + 40 * Math.sin(phi)}, 88%, 62%)`,
  idle:     () => 'hsl(0, 0%, 58%)',
}

type Vec3 = [number, number, number]

/**
 * The Hopf fibration drawn once (linked Villarceau circles, a fixed 3/4 view), then
 * folded in a simple stop-motion loop: full → collapsed → half → full. No per-frame
 * redraw — the figure is static and the *whole thing* folds via a stepped CSS scaleY.
 */
export function HopfFibration({ size = 36, state = 'thinking' }: { size?: number; state?: HopfState }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.clearRect(0, 0, size, size)

    const thetas = [0.3 * Math.PI, 0.5 * Math.PI, 0.68 * Math.PI]
    const phiCount = 10
    const psiCount = 48
    const fibers: { phi: number; pts: Vec3[] }[] = []
    let maxR = 1e-4
    for (const theta of thetas) {
      const eta = theta / 2
      for (let i = 0; i < phiCount; i++) {
        const phi = (i / phiCount) * 2 * Math.PI
        const pts: Vec3[] = []
        for (let j = 0; j <= psiCount; j++) {
          const psi = (j / psiCount) * 2 * Math.PI
          const a = Math.cos(eta) * Math.cos(phi / 2 + psi)
          const b = Math.cos(eta) * Math.sin(phi / 2 + psi)
          const c = Math.sin(eta) * Math.cos(-phi / 2 + psi)
          const d = Math.sin(eta) * Math.sin(-phi / 2 + psi)
          const s = 1 / (1.0001 - d)
          const p: Vec3 = [a * s, b * s, c * s]
          const r = Math.hypot(p[0], p[1], p[2])
          if (r > maxR) maxR = r
          pts.push(p)
        }
        fibers.push({ phi, pts })
      }
    }
    const scale = (size * 0.4) / maxR
    const cx = size / 2
    const cy = size / 2
    const ay = 0.7
    const ax = 0.5
    const cb = Math.cos(ay)
    const sb = Math.sin(ay)
    const ca = Math.cos(ax)
    const sa = Math.sin(ax)
    const palette = PALETTES[state] ?? PALETTES.thinking

    const drawn = fibers
      .map((f) => {
        let zSum = 0
        const proj = f.pts.map(([X, Y, Z]): Vec3 => {
          const x = X * cb + Z * sb
          let z = -X * sb + Z * cb
          const y = Y * ca - z * sa
          z = Y * sa + z * ca
          zSum += z
          const persp = 1 / (1.7 - z * 0.16)
          return [cx + x * scale * persp, cy + y * scale * persp, z]
        })
        return { proj, z: zSum / f.pts.length, color: palette(f.phi) }
      })
      .sort((p, q) => p.z - q.z)

    for (const f of drawn) {
      ctx.beginPath()
      for (let k = 0; k < f.proj.length; k++) {
        const px = f.proj[k]![0]
        const py = f.proj[k]![1]
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      const depth = (f.z + maxR) / (2 * maxR)
      ctx.globalAlpha = 0.3 + 0.6 * depth
      ctx.lineWidth = 0.7 + 1.2 * depth
      ctx.strokeStyle = f.color
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }, [size, state])

  return (
    <span className="inline-flex shrink-0" style={{ width: size, height: size }}>
      <canvas ref={ref} className="hopf-fold" style={{ width: size, height: size, display: 'block' }} aria-hidden />
      <style>{`
        .hopf-fold { transform-box: fill-box; transform-origin: center; animation: hopfFold 1.8s step-end infinite; }
        @keyframes hopfFold {
          0%, 24%   { transform: scaleY(1); }
          25%, 49%  { transform: scaleY(0.07); }
          50%, 74%  { transform: scaleY(0.5); }
          75%, 100% { transform: scaleY(1); }
        }
      `}</style>
    </span>
  )
}

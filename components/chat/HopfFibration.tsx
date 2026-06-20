'use client'

import { useEffect, useRef } from 'react'

// What the agent is doing — drives the fibration's color so the loader *means*
// something. Wire more states in as they're surfaced (a running tool, research, etc.).
export type HopfState = 'thinking' | 'tool' | 'research' | 'writing' | 'idle'

// Each palette maps a fiber's base-point azimuth φ (0..2π) to a stroke color.
const PALETTES: Record<HopfState, (phi: number) => string> = {
  thinking: (phi) => `hsl(${(phi / (2 * Math.PI)) * 360}, 85%, 62%)`,            // full rainbow
  tool:     (phi) => `hsl(${195 + 45 * Math.sin(phi)}, 85%, 62%)`,               // cyan/blue
  research: (phi) => `hsl(${120 + 55 * Math.sin(phi)}, 70%, 56%)`,               // greens
  writing:  (phi) => `hsl(${25 + 40 * Math.sin(phi)}, 88%, 62%)`,                // warm
  idle:     () => 'hsl(0, 0%, 58%)',
}

type Vec3 = [number, number, number]

/**
 * The Hopf fibration as a STOP-MOTION loader. The fibers (great circles on S³ over
 * sampled base points on S²) are stereographically projected to R³ — where they become
 * the linked Villarceau circles — and the figure is rendered at a small number of
 * discrete tumble phases, snapping between them with a hold on each (claymation /
 * old-school frame animation) rather than a smooth spin. Color comes from each fiber's
 * base point, and the palette is chosen by `state`.
 */
export function HopfFibration({
  size = 40,
  state = 'thinking',
  phases = 6,
  holdMs = 150,
}: {
  size?: number
  state?: HopfState
  phases?: number
  holdMs?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<HopfState>(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Keep it simple: two latitude rings of fibers. (θ→π is avoided — that fiber runs
    // through the projection pole and flies off to infinity.)
    const thetas = [0.36 * Math.PI, 0.62 * Math.PI]
    const phiCount = 6
    const psiCount = 40
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
          const s = 1 / (1.0001 - d) // stereographic from pole (0,0,0,1)
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
    const tilt = 0.62 // fixed 3/4 view so it never sits dead-on

    const drawPhase = (phase: number) => {
      const ang = (phase / Math.max(1, phases)) * 2 * Math.PI // discrete spin about Y
      const cb = Math.cos(ang)
      const sb = Math.sin(ang)
      const ca = Math.cos(tilt)
      const sa = Math.sin(tilt)
      const palette = PALETTES[stateRef.current] ?? PALETTES.thinking
      ctx.clearRect(0, 0, size, size)
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
        ctx.globalAlpha = 0.32 + 0.6 * depth
        ctx.lineWidth = 0.8 + 1.3 * depth
        ctx.strokeStyle = f.color
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    let phase = 0
    drawPhase(phase)
    const id = setInterval(() => {
      phase = (phase + 1) % phases
      drawPhase(phase)
    }, holdMs)
    return () => clearInterval(id)
  }, [size, phases, holdMs])

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden />
}

'use client'

import { useEffect, useRef, useState } from 'react'

// A Hopf-fibration-inspired loader: four linked rainbow rings that spin while the
// whole figure folds in and out (scaleY breathing) — the infold/outfold motion.
export function HopfLoader({ size = 24 }: { size?: number }) {
  const rings = [
    { rot: 0, color: '#22d3ee' },
    { rot: 45, color: '#4ade80' },
    { rot: 90, color: '#f59e0b' },
    { rot: 135, color: '#e879f9' },
  ]
  return (
    <span className="inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} className="hopf-fold">
        <g className="hopf-spin">
          {rings.map((r) => (
            <ellipse
              key={r.rot}
              cx="24" cy="24" rx="17" ry="6.5"
              fill="none" stroke={r.color} strokeWidth="2.3" strokeLinecap="round"
              transform={`rotate(${r.rot} 24 24)`}
              opacity="0.95"
            />
          ))}
        </g>
      </svg>
      <style>{`
        .hopf-spin { transform-box: fill-box; transform-origin: center; animation: hopfSpin 3.4s linear infinite; }
        .hopf-fold { transform-box: fill-box; transform-origin: center; animation: hopfFold 2.6s ease-in-out infinite; }
        @keyframes hopfSpin { to { transform: rotate(360deg); } }
        @keyframes hopfFold { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.3); } }
      `}</style>
    </span>
  )
}

// Streaming indicator — the Hopf loader plus a quiet, Claude-style elapsed read-out.
export function TypingIndicator() {
  const [elapsed, setElapsed] = useState(0)
  const start = useRef(Date.now())
  useEffect(() => {
    start.current = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  const t = m > 0 ? `${m}m ${s}s` : `${s}s`
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-[var(--color-text-tertiary)]">
      <HopfLoader />
      <span>{t} · thinking…</span>
    </div>
  )
}

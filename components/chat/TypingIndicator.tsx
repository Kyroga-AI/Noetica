'use client'

import { useEffect, useRef, useState } from 'react'
import { WorkingSequence } from '@/components/chat/WorkingSequence'

// Streaming indicator — the point→line→triangle→…→N-gon working sequence plus a quiet,
// Claude-style elapsed read-out. The polygon gains a side per beat, so it doubles as a clock.
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
      <WorkingSequence size={18} />
      <span>{t} · thinking…</span>
    </div>
  )
}

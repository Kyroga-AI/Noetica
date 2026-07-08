/**
 * useRevealedContent — a uniform typewriter/pacing gate for assistant replies.
 *
 * Reveals `full` progressively at a fixed cadence (tokens/sec), independent of how fast the underlying
 * text arrives. This makes EVERY response path render at the same speed:
 *   - model SSE stream (arrives fast, in many deltas) → paced down to the cadence,
 *   - local dialogue / command / form replies (arrive instantly, all at once) → paced up to the cadence.
 *
 * `animate` gates history vs. live: pass false for messages loaded from a stored session so they render
 * in full immediately (no replay), true for a turn produced during this view.
 *
 * Cadence is expressed in TOKENS/sec; we reveal characters at tokensPerSec * CHARS_PER_TOKEN so the knob
 * reads naturally while the animation stays smooth. tokensPerSec <= 0 disables pacing (instant).
 */
import { useEffect, useRef, useState } from 'react'

const CHARS_PER_TOKEN = 4          // rough average across tokenizers; keeps the knob in "tokens"
const TICK_MS = 50                 // reveal cadence granularity

/** Timestamp (ms) captured when the bundle first loads — anything created after this is a "live" turn. */
export const APP_OPEN_TS = Date.now()

export function useRevealedContent(full: string, opts: { tokensPerSec: number; animate: boolean }): string {
  const { tokensPerSec, animate } = opts
  const paced = animate && tokensPerSec > 0
  const [shown, setShown] = useState(() => (paced ? 0 : full.length))
  // Fractional char budget so the average rate is EXACT (10 vs 11 vs 12 tok/s are distinct), not
  // collapsed by integer-per-tick rounding.
  const accRef = useRef(shown)
  accRef.current = Math.max(accRef.current, shown)

  useEffect(() => {
    if (!paced) { setShown(full.length); return }
    if (accRef.current >= full.length) { setShown(full.length); return }
    const charsPerTick = (tokensPerSec * CHARS_PER_TOKEN * TICK_MS) / 1000
    const id = setInterval(() => {
      accRef.current = Math.min(full.length, accRef.current + charsPerTick)
      const next = Math.floor(accRef.current)
      setShown(next)
      if (accRef.current >= full.length) clearInterval(id)
    }, TICK_MS)
    return () => clearInterval(id)
    // Re-run as `full` grows (streaming) so the reveal keeps chasing the new length at the fixed rate.
  }, [full, paced, tokensPerSec])

  return paced ? full.slice(0, shown) : full
}

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

// How much of each message has ALREADY been revealed, keyed by message id — module-level so it survives
// component remounts. Without this, refocusing the window (which remounts the message list) resets the
// reveal state to 0 and the last answer "replays" its typewriter as if it just finished. With it, a
// message that already finished revealing renders in full immediately; a mid-stream one resumes.
const revealedLen = new Map<string, number>()

export function useRevealedContent(full: string, opts: { tokensPerSec: number; animate: boolean; id?: string }): string {
  const { tokensPerSec, animate, id } = opts
  const paced = animate && tokensPerSec > 0
  const [shown, setShown] = useState(() => {
    if (!paced) return full.length
    // Resume from whatever was already revealed for this id (0 on first mount; full.length if it finished).
    return id ? Math.min(full.length, revealedLen.get(id) ?? 0) : 0
  })
  // Fractional char budget so the average rate is EXACT (10 vs 11 vs 12 tok/s are distinct), not
  // collapsed by integer-per-tick rounding.
  const accRef = useRef(shown)
  accRef.current = Math.max(accRef.current, shown)

  const record = (n: number) => { if (id) revealedLen.set(id, Math.max(revealedLen.get(id) ?? 0, n)) }

  useEffect(() => {
    if (!paced) { setShown(full.length); return }
    if (accRef.current >= full.length) { setShown(full.length); record(full.length); return }
    const charsPerTick = (tokensPerSec * CHARS_PER_TOKEN * TICK_MS) / 1000
    const timer = setInterval(() => {
      accRef.current = Math.min(full.length, accRef.current + charsPerTick)
      const next = Math.floor(accRef.current)
      setShown(next)
      record(next)
      if (accRef.current >= full.length) clearInterval(timer)
    }, TICK_MS)
    return () => clearInterval(timer)
    // Re-run as `full` grows (streaming) so the reveal keeps chasing the new length at the fixed rate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, paced, tokensPerSec])

  return paced ? full.slice(0, shown) : full
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

interface DialogueTurn { speaker: 'Host' | 'Guest'; line: string }
type Format = 'brief' | 'critique' | 'debate'

function pickVoices(): { host: SpeechSynthesisVoice | null; guest: SpeechSynthesisVoice | null } {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  if (voices.length === 0) return { host: null, guest: null }
  return { host: voices[0] ?? null, guest: voices[1] ?? voices[0] ?? null }
}

function speak(line: string, voice: SpeechSynthesisVoice | null, rate = 1.0): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(line)
  if (voice) u.voice = voice
  u.rate = rate
  return u
}

interface Props { refreshSignal?: number }

export function AudioOverviewPlayer({ refreshSignal = 0 }: Props) {
  const [hasDocs, setHasDocs] = useState(false)
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<Format>('brief')
  const [loading, setLoading] = useState(false)
  const [turns, setTurns] = useState<DialogueTurn[]>([])
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const cancelledRef = useRef(false)

  // Check if indexed user docs exist — refresh on each new upload
  useEffect(() => {
    fetch(amUrl('/api/ingest/status'))
      .then((r) => r.ok ? r.json() : null)
      .then((d: { summary?: { done?: number } } | null) => { if ((d?.summary?.done ?? 0) > 0) setHasDocs(true) })
      .catch(() => {})
  }, [refreshSignal])

  // Preload voices (browser may load them async)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => { if (window.speechSynthesis.getVoices().length > 0) clearInterval(id) }, 200)
    return () => clearInterval(id)
  }, [open])

  async function generate() {
    setLoading(true)
    setError('')
    setTurns([])
    setCurrentIdx(-1)
    try {
      const r = await fetch(amUrl(`/api/study/audio-overview?format=${format}`), { signal: AbortSignal.timeout(120_000) })
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string }
        setError(d.error === 'no_docs' ? 'No indexed documents found.' : 'Generation failed.')
        return
      }
      const d = await r.json() as { turns?: DialogueTurn[] }
      setTurns(d.turns ?? [])
    } catch {
      setError('Request timed out or failed.')
    } finally {
      setLoading(false)
    }
  }

  function playFrom(idx: number) {
    window.speechSynthesis.cancel()
    cancelledRef.current = false
    setPlaying(true)
    const { host, guest } = pickVoices()

    function playNext(i: number) {
      if (cancelledRef.current || i >= turns.length) { setPlaying(false); setCurrentIdx(-1); return }
      setCurrentIdx(i)
      const t = turns[i]!
      const u = speak(t.line, t.speaker === 'Host' ? host : guest)
      u.onend = () => playNext(i + 1)
      u.onerror = () => { setPlaying(false); setCurrentIdx(-1) }
      window.speechSynthesis.speak(u)
    }
    playNext(idx)
  }

  function pause() {
    cancelledRef.current = true
    window.speechSynthesis.cancel()
    setPlaying(false)
    setCurrentIdx(-1)
  }

  if (!hasDocs) return null

  return (
    <div className="mb-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M5.5 4.5l4 2.5-4 2.5V4.5z" fill="currentColor"/>
          </svg>
          Audio Overview
        </button>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-[12px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-[var(--color-text-secondary)]">Audio Overview</span>
            <button
              type="button"
              onClick={() => { setOpen(false); pause() }}
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              title="Close"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {turns.length === 0 && !loading && (
            <div className="mb-2 flex items-center gap-2">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className="rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] outline-none"
              >
                <option value="brief">Brief deep-dive</option>
                <option value="critique">Critical discussion</option>
                <option value="debate">Debate</option>
              </select>
              <button
                type="button"
                onClick={() => void generate()}
                className="rounded-md bg-[#7c3aed] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#6d28d9] transition"
              >
                Generate
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 py-1 text-[var(--color-text-tertiary)]">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-border-tertiary)] border-t-[#7c3aed]" />
              Generating audio script…
            </div>
          )}

          {error && <div className="py-1 text-[#ef4444]">{error}</div>}

          {turns.length > 0 && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playing ? pause() : playFrom(Math.max(0, currentIdx))}
                  className="flex items-center gap-1.5 rounded-md bg-[#7c3aed] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#6d28d9] transition"
                >
                  {playing ? (
                    <>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
                        <rect x="1.5" y="1" width="2.5" height="8" rx="0.5"/>
                        <rect x="6" y="1" width="2.5" height="8" rx="0.5"/>
                      </svg>
                      Pause
                    </>
                  ) : (
                    <>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
                        <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
                      </svg>
                      {currentIdx >= 0 ? 'Resume' : 'Play'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="rounded-md border border-[var(--color-border-tertiary)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition"
                >
                  Regenerate
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {turns.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => playFrom(i)}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left transition ${
                      i === currentIdx
                        ? 'bg-[rgba(124,58,237,0.12)] border border-[rgba(124,58,237,0.3)]'
                        : 'hover:bg-[var(--color-background-tertiary)]'
                    }`}
                  >
                    <span className={`mr-2 text-[10px] font-semibold uppercase tracking-wide ${t.speaker === 'Host' ? 'text-[#7c3aed]' : 'text-[#0891b2]'}`}>
                      {t.speaker}
                    </span>
                    <span className="text-[var(--color-text-primary)]">{t.line}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

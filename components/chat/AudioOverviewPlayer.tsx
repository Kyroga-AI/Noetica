'use client'

import { useEffect, useRef, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'
import { useSettings } from '@/lib/settings/context'

interface DialogueTurn { speaker: 'Host' | 'Guest'; line: string; audio_b64?: string; callin?: boolean }
type Format = 'brief' | 'critique' | 'debate'
type CallinState = 'idle' | 'recording' | 'transcribing' | 'answering'

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

async function playAudioB64(b64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:audio/mp3;base64,${b64}`)
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('audio playback error'))
    audio.play().catch(reject)
  })
}

interface Props { refreshSignal?: number }

export function AudioOverviewPlayer({ refreshSignal = 0 }: Props) {
  const { settings } = useSettings()
  const [hasDocs, setHasDocs] = useState(false)
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<Format>('brief')
  const [loading, setLoading] = useState(false)
  const [turns, setTurns] = useState<DialogueTurn[]>([])
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const cancelledRef = useRef(false)
  const [callinState, setCallinState] = useState<CallinState>('idle')
  const [callinError, setCallinError] = useState('')
  const [sttAvailable, setSttAvailable] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Check if indexed user docs exist — refresh on each new upload
  useEffect(() => {
    fetch(amUrl('/api/ingest/status'))
      .then((r) => r.ok ? r.json() : null)
      .then((d: { summary?: { done?: number } } | null) => { if ((d?.summary?.done ?? 0) > 0) setHasDocs(true) })
      .catch(() => {})
  }, [refreshSignal])

  // Check STT availability on open
  useEffect(() => {
    if (!open) return
    fetch(amUrl('/api/stt/status')).then((r) => r.ok ? r.json() : null).then((d: { available?: boolean } | null) => {
      setSttAvailable(d?.available === true)
    }).catch(() => {})
  }, [open])

  // Preload voices (browser may load them async)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => { if (window.speechSynthesis.getVoices().length > 0) clearInterval(id) }, 200)
    return () => clearInterval(id)
  }, [open])

  async function startCallin() {
    if (callinState !== 'idle') return
    setCallinError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setCallinError('Microphone access denied.')
      return
    }
    // Pause playback while recording
    const wasPlaying = playing
    if (wasPlaying) {
      cancelledRef.current = true
      window.speechSynthesis.cancel()
      setPlaying(false)
    }
    setCallinState('recording')
    chunksRef.current = []
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorderRef.current = mr
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      void submitCallin(wasPlaying)
    }
    mr.start()
  }

  function stopCallin() {
    if (callinState !== 'recording') return
    mediaRecorderRef.current?.stop()
  }

  async function submitCallin(resumeAfter: boolean) {
    setCallinState('transcribing')
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const sttRes = await fetch(amUrl('/api/stt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio_b64: b64 }),
      })
      if (!sttRes.ok) { setCallinError('Transcription failed.'); setCallinState('idle'); return }
      const sttData = await sttRes.json() as { text?: string }
      const question = (sttData.text ?? '').trim()
      if (!question) { setCallinError('Could not transcribe audio. Try again.'); setCallinState('idle'); return }

      setCallinState('answering')
      const useTTS = !!settings.openaiApiKey
      const contextTurns = turns.slice(Math.max(0, (currentIdx >= 0 ? currentIdx : turns.length) - 4))
      const callinRes = await fetch(amUrl('/api/study/audio-overview/callin'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, context_turns: contextTurns, synthesize: useTTS, voice_host: 'nova' }),
      })
      if (!callinRes.ok) { setCallinError('Failed to generate host reply.'); setCallinState('idle'); return }
      const callinData = await callinRes.json() as { turns?: DialogueTurn[] }
      const newTurns = (callinData.turns ?? []).map((t) => ({ ...t, callin: true }))
      if (!newTurns.length) { setCallinError('No reply generated.'); setCallinState('idle'); return }

      // Insert the call-in turns after the current position
      const insertAt = currentIdx >= 0 ? currentIdx + 1 : turns.length
      setTurns((prev) => [...prev.slice(0, insertAt), ...newTurns, ...prev.slice(insertAt)])
      setCallinState('idle')
      // Auto-play the call-in exchange
      cancelledRef.current = false
      setPlaying(true)
      const { host, guest } = pickVoices()
      async function playCallin(i: number, endIdx: number): Promise<void> {
        if (cancelledRef.current || i > endIdx) {
          setPlaying(false)
          if (resumeAfter) void new Promise<void>((r) => setTimeout(r, 200)).then(() => {
            if (!cancelledRef.current) playFrom(endIdx + 1)
          })
          return
        }
        setCurrentIdx(i)
        const t = newTurns[i - insertAt]
        if (!t) { setPlaying(false); return }
        if (t.audio_b64) {
          try { await playAudioB64(t.audio_b64) } catch { /* */ }
          if (!cancelledRef.current) void playCallin(i + 1, endIdx)
        } else {
          const u = speak(t.line, t.speaker === 'Host' ? host : guest)
          u.onend = () => { void playCallin(i + 1, endIdx) }
          u.onerror = () => { setPlaying(false); setCurrentIdx(-1) }
          window.speechSynthesis.speak(u)
        }
      }
      void playCallin(insertAt, insertAt + newTurns.length - 1)
    } catch {
      setCallinError('Call-in failed. Try again.')
      setCallinState('idle')
    }
  }

  async function generate() {
    setLoading(true)
    setError('')
    setTurns([])
    setCurrentIdx(-1)
    try {
      const useTTS = !!settings.openaiApiKey
      const params = new URLSearchParams({ format })
      if (useTTS) { params.set('synthesize', '1'); params.set('voice_host', 'nova'); params.set('voice_guest', 'echo') }
      const r = await fetch(amUrl(`/api/study/audio-overview?${params.toString()}`), { signal: AbortSignal.timeout(180_000) })
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string }
        setError(d.error === 'no_docs' ? 'No indexed documents found.' : 'Generation failed.')
        return
      }
      const d = await r.json() as { turns?: DialogueTurn[]; synthesized?: boolean }
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

    async function playNext(i: number): Promise<void> {
      if (cancelledRef.current || i >= turns.length) { setPlaying(false); setCurrentIdx(-1); return }
      setCurrentIdx(i)
      const t = turns[i]!
      if (t.audio_b64) {
        try { await playAudioB64(t.audio_b64) } catch { /* fall through to browser TTS */ }
        if (!cancelledRef.current) return playNext(i + 1)
      } else {
        const u = speak(t.line, t.speaker === 'Host' ? host : guest)
        u.onend = () => { void playNext(i + 1) }
        u.onerror = () => { setPlaying(false); setCurrentIdx(-1) }
        window.speechSynthesis.speak(u)
      }
    }
    void playNext(idx)
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
              <div className="mb-2 flex items-center gap-2 flex-wrap">
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
                {sttAvailable && (
                  <button
                    type="button"
                    onClick={() => callinState === 'recording' ? stopCallin() : void startCallin()}
                    disabled={callinState === 'transcribing' || callinState === 'answering'}
                    title={callinState === 'recording' ? 'Stop recording' : 'Call in with a question'}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                      callinState === 'recording'
                        ? 'bg-[#dc2626] text-white hover:bg-[#b91c1c] animate-pulse'
                        : callinState === 'idle'
                        ? 'border border-[var(--color-border-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                        : 'border border-[var(--color-border-tertiary)] text-[var(--color-text-tertiary)] opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <svg width="9" height="11" viewBox="0 0 10 12" fill="none" aria-hidden>
                      <rect x="3" y="0.5" width="4" height="7" rx="2" fill="currentColor"/>
                      <path d="M1 6c0 2.21 1.79 4 4 4s4-1.79 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                      <line x1="5" y1="10" x2="5" y2="11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    {callinState === 'recording' ? 'Stop' : callinState === 'transcribing' ? 'Transcribing…' : callinState === 'answering' ? 'Answering…' : 'Call in'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="rounded-md border border-[var(--color-border-tertiary)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition"
                >
                  Regenerate
                </button>
              </div>
              {callinError && (
                <div className="mb-1 text-[10px] text-[#ef4444]">{callinError}</div>
              )}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {turns.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => playFrom(i)}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left transition ${
                      i === currentIdx
                        ? 'bg-[rgba(124,58,237,0.12)] border border-[rgba(124,58,237,0.3)]'
                        : t.callin
                        ? 'bg-[rgba(8,145,178,0.06)] border border-[rgba(8,145,178,0.15)] hover:bg-[rgba(8,145,178,0.1)]'
                        : 'hover:bg-[var(--color-background-tertiary)]'
                    }`}
                  >
                    <span className={`mr-2 text-[10px] font-semibold uppercase tracking-wide ${t.speaker === 'Host' ? 'text-[#7c3aed]' : 'text-[#0891b2]'}`}>
                      {t.speaker}{t.callin && t.speaker === 'Guest' ? ' (you)' : ''}
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

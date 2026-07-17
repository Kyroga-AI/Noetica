'use client'

/**
 * VoiceTrainer — record or upload a short reference clip, clone it locally with XTTS-v2,
 * and set it as the agent's speaking voice. Fully local: audio is sent only to the
 * on-device voice sidecar (127.0.0.1:8124 via the agent-machine /api/voice/* proxy).
 */
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { isTauri } from '@/lib/tauri/bridge'
import { getMicStream, MicPermissionDeniedError } from '@/lib/voice/micStream'

function amUrl(path: string): string {
  return isTauri() ? `http://127.0.0.1:8080${path}` : path
}

interface Voice { id: string; name: string }

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export function VoiceTrainer() {
  const { settings, update } = useSettings()
  const [provisioned, setProvisioned] = useState<boolean | null>(null)
  const [voices, setVoices] = useState<Voice[]>([])
  const [recording, setRecording] = useState(false)
  const [clip, setClip] = useState<Blob | null>(null)
  const [name, setName] = useState('My voice')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [provStep, setProvStep] = useState('')
  const [provError, setProvError] = useState('')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function refresh() {
    try {
      const r = await fetch(amUrl('/api/voice/status'), { signal: AbortSignal.timeout(8000) })
      const j = (await r.json()) as { provisioned: boolean; voices?: Voice[]; running?: boolean; step?: string; error?: string }
      setProvisioned(j.provisioned)
      setVoices(j.voices ?? [])
      setProvStep(j.running ? (j.step ?? 'working…') : '')
      setProvError(j.error ?? '')
      return j
    } catch { setProvisioned(false); return null }
  }
  useEffect(() => { void refresh() }, [])

  async function provision() {
    setProvError('')
    setProvStep('starting…')
    try { await fetch(amUrl('/api/voice/provision'), { method: 'POST', signal: AbortSignal.timeout(8000) }) } catch { /* */ }
    // Poll until provisioned or errored (the install downloads several GB — can take a while).
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const j = await refresh()
      if (j?.provisioned || (j && !j.running)) break
    }
  }

  async function startRec() {
    try {
      // Shared app-wide mic stream — reused, and left live after recording so the
      // OS mic gate isn't re-triggered elsewhere in the app.
      const stream = await getMicStream()
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => { setClip(new Blob(chunksRef.current, { type: 'audio/webm' })) }
      rec.start(); recRef.current = rec; setRecording(true); setStatus('')
    } catch (e) { setStatus(e instanceof MicPermissionDeniedError ? e.message : 'Microphone access denied') }
  }
  function stopRec() { recRef.current?.stop(); setRecording(false) }

  async function clone() {
    if (!clip) return
    setBusy(true); setStatus('Cloning your voice…')
    try {
      const b64 = await blobToB64(clip)
      const r = await fetch(amUrl('/api/voice/clone'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, audio_b64: b64 }),
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { hint?: string; error?: string }
        setStatus(`Clone failed: ${e.hint || e.error || r.status}`); return
      }
      const j = (await r.json()) as { voice_id: string }
      setClip(null); setStatus('Cloned ✓ — set as your agent voice')
      update({ ttsProvider: 'cloned', clonedVoiceId: j.voice_id })
      await refresh()
    } catch { setStatus('Clone failed') } finally { setBusy(false) }
  }

  async function test(id: string) {
    setBusy(true); setStatus('Synthesizing… (first run loads the model — can take ~30s)')
    try {
      const r = await fetch(amUrl('/api/voice/tts'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello. This is your cloned voice, speaking locally from Noetica.', voice_id: id }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!r.ok) { setStatus('Synthesis failed — if this is the first run, retry once the model has loaded.'); return }
      const url = URL.createObjectURL(await r.blob())
      const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); void a.play()
      setStatus('')
    } catch { setStatus('Synthesis timed out — the model may still be loading. Retry shortly.') } finally { setBusy(false) }
  }

  const activeId = settings.clonedVoiceId

  return (
    <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-extrabold text-[var(--color-text-primary)]">Voice Trainer</span>
          <span className="rounded-full bg-[#fffbeb] border border-[#fde68a] px-2 py-0.5 text-[9.5px] font-semibold text-[#92400e]">XTTS-v2 · local</span>
        </div>
        {settings.ttsProvider === 'cloned' && activeId
          ? <span className="text-[10px] text-[var(--color-text-tertiary)]">speaking as &ldquo;{voices.find((v) => v.id === activeId)?.name ?? activeId}&rdquo;</span>
          : <span className="text-[10px] text-[var(--color-text-tertiary)]">clone a voice to use it</span>}
      </div>

      {provisioned === false && (
        <div className="mt-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]">
          Voice cloning isn't set up yet — this installs a local XTTS model (downloads a few GB, one time). Requires <code className="font-mono">uv</code>.
          {provStep ? (
            <div className="mt-1.5 flex items-center gap-2 text-[11px]"><span className="animate-pulse">⏳</span> {provStep}</div>
          ) : (
            <button onClick={() => void provision()} className="mt-1.5 rounded-lg bg-[#b45309] px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-[#92400e]">Set up voice cloning</button>
          )}
          {provError && <div className="mt-1 text-[11px] text-[#b91c1c]">{provError}</div>}
        </div>
      )}

      {provisioned && (
        <>
          <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">Record 60+ seconds of clear speech (or upload a clip), then clone it locally with XTTS-v2.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!recording
              ? <button onClick={() => void startRec()} disabled={busy} className="rounded-lg border border-[#fca5a5] bg-[var(--color-background-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] disabled:opacity-50"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ef4444]" />Record</button>
              : <button onClick={stopRec} className="rounded-lg bg-[#dc2626] px-3 py-1.5 text-[12px] font-medium text-white">■ Stop</button>}
            <label className="cursor-pointer rounded-lg border border-[var(--color-border-secondary)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)]">
              Upload clip
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setClip(f); setStatus('Clip ready') } }} />
            </label>
            {clip && <span className="text-[11px] text-[var(--color-text-tertiary)]">clip ready ({Math.round(clip.size / 1024)} KB)</span>}
          </div>
          {clip && (
            <div className="mt-2 flex items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Voice name" className="w-40 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]" />
              <button onClick={() => void clone()} disabled={busy} className="rounded-lg bg-[#1d4ed8] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">Clone voice</button>
            </div>
          )}

          {voices.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {voices.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
                  <span className="text-[12px] text-[var(--color-text-primary)]">{v.name}{activeId === v.id && settings.ttsProvider === 'cloned' && <span className="ml-1.5 text-[10px] text-[#16a34a]">● active</span>}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => void test(v.id)} disabled={busy} className="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] disabled:opacity-50">Test</button>
                    <button onClick={() => update({ ttsProvider: 'cloned', clonedVoiceId: v.id })} className="rounded-md bg-[var(--color-background-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-primary)]">Use</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {status && <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">{status}</p>}
      <p className="mt-3 border-t border-[var(--color-border-tertiary)] pt-2 text-[10px] text-[var(--color-text-tertiary)]">
        Requires microphone access and Agent Machine running locally.
      </p>
    </div>
  )
}

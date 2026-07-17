'use client'

/**
 * VoiceTrainer - record or upload a short reference clip, clone it locally with XTTS-v2,
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
      setProvStep(j.running ? (j.step ?? 'working...') : '')
      setProvError(j.error ?? '')
      return j
    } catch { setProvisioned(false); return null }
  }
  useEffect(() => { void refresh() }, [])

  async function provision() {
    setProvError('')
    setProvStep('starting...')
    try { await fetch(amUrl('/api/voice/provision'), { method: 'POST', signal: AbortSignal.timeout(8000) }) } catch { /* */ }
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const j = await refresh()
      if (j?.provisioned || (j && !j.running)) break
    }
  }

  async function startRec() {
    try {
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
    setBusy(true); setStatus('Cloning your voice...')
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
      setClip(null); setStatus('Cloned - set as your agent voice')
      update({ ttsProvider: 'cloned', clonedVoiceId: j.voice_id })
      await refresh()
    } catch { setStatus('Clone failed') } finally { setBusy(false) }
  }

  async function test(id: string) {
    setBusy(true); setStatus('Synthesizing... (first run loads the model - can take ~30s)')
    try {
      const r = await fetch(amUrl('/api/voice/tts'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello. This is your cloned voice, speaking locally from Noetica.', voice_id: id }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!r.ok) { setStatus('Synthesis failed - if this is the first run, retry once the model has loaded.'); return }
      const url = URL.createObjectURL(await r.blob())
      const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); void a.play()
      setStatus('')
    } catch { setStatus('Synthesis timed out - the model may still be loading. Retry shortly.') } finally { setBusy(false) }
  }

  const activeId = settings.clonedVoiceId

  return (
    <div style={{ background: 'var(--paper-sunk)', borderRadius: 14, padding: 16, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>Voice Trainer</div>
        <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--pending-soft)', color: 'var(--pending-fg)', padding: '2px 8px', borderRadius: 999 }}>XTTS-v2 · local</span>
      </div>

      {provisioned === false && (
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
          Voice cloning is not set up yet - this installs a local XTTS model (downloads a few GB, one time).
          {provStep ? (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink3)' }}>{provStep}</div>
          ) : (
            <button
              onClick={() => void provision()}
              style={{ display: 'block', marginTop: 6, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent' }}
            >
              Set up voice cloning
            </button>
          )}
          {provError && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--danger-fg)' }}>{provError}</div>}
        </div>
      )}

      {provisioned && (
        <>
          <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
            Record 60+ seconds of your voice, and Noetica clones it locally using XTTS-v2. Audio never leaves this device. The cloned voice becomes available as a TTS option in Voice settings.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!recording ? (
              <button
                onClick={() => void startRec()}
                disabled={busy}
                style={{ padding: '9px 16px', borderRadius: 10, border: '1.5px solid var(--danger)', color: 'var(--danger-fg)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', opacity: busy ? 0.5 : 1 }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} />
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRec}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--danger)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 7 }}
              >
                Stop recording
              </button>
            )}
            <button
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'audio/*'
                input.onchange = () => { const f = input.files?.[0]; if (f) { setClip(f); setStatus('Clip ready') } }
                input.click()
              }}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent' }}
            >
              {clip ? 'Replace clip' : 'Upload clip'}
            </button>
          </div>
          {clip && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>clip ready ({Math.round(clip.size / 1024)} KB)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Voice name"
                style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: "'Manrope',sans-serif", color: 'var(--ink)', background: 'var(--paper)' }}
              />
              <button
                onClick={() => void clone()}
                disabled={busy}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', opacity: busy ? 0.5 : 1 }}
              >
                Clone voice
              </button>
            </div>
          )}

          {voices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
              {voices.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--paper-sunk-2)', borderRadius: 9, border: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink)', flex: 1 }}>
                    {v.name}
                    {activeId === v.id && settings.ttsProvider === 'cloned' && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--verified-fg)' }}>active</span>
                    )}
                  </span>
                  <button
                    onClick={() => void test(v.id)}
                    disabled={busy}
                    style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer', background: 'transparent', opacity: busy ? 0.5 : 1 }}
                  >
                    Test
                  </button>
                  <button
                    onClick={() => update({ ttsProvider: 'cloned', clonedVoiceId: v.id })}
                    style={{ padding: '5px 12px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none' }}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {status && <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{status}</div>}
      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Requires microphone access and Agent Machine running locally.</div>
    </div>
  )
}

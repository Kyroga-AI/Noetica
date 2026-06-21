'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

export type VoiceState = 'idle' | 'listening' | 'processing' | 'wake-listening'

const WAKE_WORD = 'hey noetica'

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((e: { results: { [i: number]: { [i: number]: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SRCtor = new () => SR

export function useVoice(onTranscript: (text: string) => void) {
  const { settings } = useSettings()
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SR | null>(null)
  const wakeListenerRef = useRef<SR | null>(null)
  const stateRef = useRef<VoiceState>('idle')
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [isLive, setIsLive] = useState(false)
  const liveRef = useRef(false)
  const vadRef = useRef<{ ctx: AudioContext; raf: number } | null>(null)
  const startListenRef = useRef<() => void>(() => {})

  stateRef.current = state

  const SpeechRecognitionCtor: SRCtor | undefined =
    typeof window !== 'undefined'
      ? ((window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition
          ?? (window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition)
      : undefined

  const isSupported = !!SpeechRecognitionCtor

  const startListening = useCallback(async () => {
    // Plain browser: Web Speech (streaming). In Tauri (no Web Speech) — and for local-first by
    // default — record with MediaRecorder and transcribe locally via whisper (/api/stt).
    if (SpeechRecognitionCtor && !isTauri()) {
      if (recognitionRef.current) recognitionRef.current.abort()
      const rec = new SpeechRecognitionCtor()
      rec.continuous = false; rec.interimResults = false; rec.lang = 'en-US'
      rec.onstart = () => setState('listening')
      rec.onresult = (e) => {
        const transcript = (e.results[0]?.[0]?.transcript ?? '').trim()
        setState('processing')
        if (transcript) onTranscript(transcript)
        setTimeout(() => setState('idle'), 300)
      }
      rec.onerror = () => { setState('idle'); setError(null) }
      rec.onend = () => { if (stateRef.current === 'listening') setState('idle') }
      recognitionRef.current = rec
      rec.start()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('processing')
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = async () => {
          try {
            const amBase = isTauri() ? 'http://127.0.0.1:8080' : ''
            const res = await fetch(`${amBase}/api/stt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio_b64: String(reader.result) }), signal: AbortSignal.timeout(90_000) })
            const j = (await res.json()) as { text?: string; error?: string }
            if (j.text?.trim()) { setError(null); onTranscript(j.text.trim()) }
            else if (j.error) setError(`Speech-to-text unavailable: ${j.error}`)
            else setError('Heard nothing — try again, closer to the mic.')
          } catch {
            // fetch threw → the voice backend isn't reachable. Make that explicit
            // instead of failing silently, and stop the live loop so it can't stall.
            liveRef.current = false; setIsLive(false)
            setError('Voice backend offline — start the Agent Machine (port 8080) and try again.')
          } finally { setState('idle') }
        }
        reader.readAsDataURL(blob)
      }
      mediaRef.current = rec
      rec.start()
      setState('listening')
      // Live mode: hands-free turn detection — auto-stop after a silence once speech is heard.
      if (liveRef.current) {
        try {
          const ctx = new AudioContext()
          const src = ctx.createMediaStreamSource(stream)
          const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an)
          const buf = new Float32Array(an.fftSize)
          let sawSpeech = false, silenceStart = 0
          const stopVad = () => { if (vadRef.current) { cancelAnimationFrame(vadRef.current.raf); void vadRef.current.ctx.close().catch(() => {}); vadRef.current = null } }
          const tick = () => {
            an.getFloatTimeDomainData(buf)
            let sum = 0; for (const v of buf) sum += v * v
            const rms = Math.sqrt(sum / buf.length)
            const now = performance.now()
            if (rms > 0.02) { sawSpeech = true; silenceStart = 0 }
            else if (sawSpeech) { if (!silenceStart) silenceStart = now; else if (now - silenceStart > 1500) { stopVad(); if (rec.state !== 'inactive') rec.stop(); return } }
            if (vadRef.current) vadRef.current.raf = requestAnimationFrame(tick)
          }
          vadRef.current = { ctx, raf: requestAnimationFrame(tick) }
        } catch { /* no VAD — manual stop still works */ }
      }
    } catch { setError('Microphone access denied'); setState('idle') }
  }, [SpeechRecognitionCtor, onTranscript])
  startListenRef.current = startListening

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch { /* */ } }
    if (mediaRef.current && mediaRef.current.state !== 'inactive') { try { mediaRef.current.stop() } catch { /* */ } }
    else setState('idle')
  }, [])

  // Wake word listener — runs continuously in background
  useEffect(() => {
    if (!SpeechRecognitionCtor || !settings.wakeWordEnabled) {
      wakeListenerRef.current?.abort()
      wakeListenerRef.current = null
      return
    }

    function startWakeListener() {
      if (!SpeechRecognitionCtor) return
      const rec = new SpeechRecognitionCtor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'

      rec.onresult = (e) => {
        const results = e.results
        const transcript = Object.keys(results)
          .map((i) => results[+i]?.[0]?.transcript ?? '')
          .join(' ')
          .toLowerCase()
        if (transcript.includes(WAKE_WORD) && stateRef.current === 'idle') {
          rec.stop()
          startListening()
        }
      }
      rec.onend = () => {
        if (stateRef.current === 'idle' || stateRef.current === 'wake-listening') {
          setTimeout(startWakeListener, 500)
        }
      }
      wakeListenerRef.current = rec
      setState('wake-listening')
      rec.start()
    }

    startWakeListener()

    return () => {
      wakeListenerRef.current?.abort()
      wakeListenerRef.current = null
    }
  }, [settings.wakeWordEnabled, SpeechRecognitionCtor, startListening])

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const speak = useCallback(async (text: string) => {
    if (typeof window === 'undefined') return

    // Stop any in-progress playback
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    window.speechSynthesis?.cancel()

    const amBase = 'http://127.0.0.1:8080'
    const truncated = text.slice(0, 4096)

    function playAudioBlob(blob: Blob): Promise<void> {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        const done = () => {
          URL.revokeObjectURL(url); audioRef.current = null
          if (liveRef.current) setTimeout(() => startListenRef.current(), 350)  // re-listen for the next turn
          resolve()
        }
        audio.onended = done; audio.onerror = done
        void audio.play().catch(done)
      })
    }

    const provider = settings.ttsProvider ?? 'openai'

    // Tier 0: Cloned voice — the user's own locally-trained XTTS-v2 voice (fully local)
    if (provider === 'cloned' && settings.clonedVoiceId) {
      try {
        const res = await fetch(`${amBase}/api/voice/tts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: truncated, voice_id: settings.clonedVoiceId, language: (settings.voiceLanguage ?? 'en-US').slice(0, 2) }),
          signal: AbortSignal.timeout(60_000),
        })
        if (res.ok) { await playAudioBlob(await res.blob()); return }
      } catch { /* fall through to other tiers */ }
    }

    // Tier 1: ElevenLabs — highest quality, supports accent/voice variety
    if (provider === 'elevenlabs' && settings.elevenlabsApiKey && settings.elevenlabsVoiceId) {
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenlabsVoiceId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'xi-api-key': settings.elevenlabsApiKey,
          },
          body: JSON.stringify({
            text: truncated,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
          signal: AbortSignal.timeout(20_000),
        })
        if (res.ok) { await playAudioBlob(await res.blob()); return }
      } catch { /* fall through */ }
    }

    // Tier 2: OpenAI TTS via agent-machine proxy
    if (provider !== 'system' && settings.openaiApiKey) {
      try {
        const res = await fetch(`${amBase}/api/tts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: truncated, voice: settings.ttsVoice ?? 'nova', api_key: settings.openaiApiKey }),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.ok) { await playAudioBlob(await res.blob()); return }
      } catch { /* fall through */ }
    }

    // Tier 3: macOS `say` via Tauri — configurable voice name
    if (isTauri()) {
      const macVoice = settings.macVoice || 'Ava'
      await invokeTauri('speak_text', { text: truncated, voice: macVoice })
      if (liveRef.current) setTimeout(() => startListenRef.current(), 800)
      return
    }

    // Tier 4: Web Speech API — last resort, picks best available en voice
    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = settings.voiceLanguage ?? 'en-US'
      const voices = window.speechSynthesis.getVoices()
      const macVoice = settings.macVoice || 'Ava'
      const best = voices.find(v => v.name === macVoice)
        ?? voices.find(v => v.localService && v.lang.startsWith('en-AU'))
        ?? voices.find(v => v.localService && v.lang.startsWith('en'))
      if (best) utterance.voice = best
      utterance.rate = 1.0
      utterance.pitch = 1.0
      window.speechSynthesis.speak(utterance)
    }
  }, [settings.voiceLanguage, settings.openaiApiKey, settings.ttsVoice, settings.ttsProvider,
      settings.elevenlabsApiKey, settings.elevenlabsVoiceId, settings.macVoice])

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (isTauri()) {
      void invokeTauri('stop_speaking')
    } else if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  // Live (continuous) conversation: listen → transcribe → send → speak → re-listen, hands-free.
  const startLive = useCallback(() => { liveRef.current = true; setIsLive(true); void startListening() }, [startListening])
  const stopLive = useCallback(() => {
    liveRef.current = false; setIsLive(false)
    if (vadRef.current) { cancelAnimationFrame(vadRef.current.raf); void vadRef.current.ctx.close().catch(() => {}); vadRef.current = null }
    if (mediaRef.current && mediaRef.current.state !== 'inactive') { try { mediaRef.current.stop() } catch { /* */ } }
    stopSpeaking()
    setState('idle')
  }, [stopSpeaking])

  return { state, error, isSupported, isLive, startListening, stopListening, startLive, stopLive, speak, stopSpeaking }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

export type VoiceState = 'idle' | 'listening' | 'processing' | 'wake-listening'

const WAKE_WORD = 'hey claude'

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

  stateRef.current = state

  const SpeechRecognitionCtor: SRCtor | undefined =
    typeof window !== 'undefined'
      ? ((window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition
          ?? (window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition)
      : undefined

  const isSupported = !!SpeechRecognitionCtor

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor) { setError('Speech recognition not supported'); return }
    if (recognitionRef.current) recognitionRef.current.abort()

    const rec = new SpeechRecognitionCtor()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'

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
  }, [SpeechRecognitionCtor, onTranscript])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setState('idle')
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

    const openaiKey = settings.openaiApiKey

    // Tier 1: OpenAI TTS via agent-machine (nova voice — genuinely sounds great)
    if (openaiKey) {
      try {
        const res = await fetch('http://127.0.0.1:8080/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 4096), voice: settings.ttsVoice ?? 'nova', api_key: openaiKey }),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null }
          await audio.play()
          return
        }
      } catch { /* fall through to system voice */ }
    }

    // Tier 2: macOS `say` command via Tauri — much better than Web Speech API
    if (isTauri()) {
      // Best macOS enhanced voices in preference order
      const macVoice = 'Zoe'
      await invokeTauri('speak_text', { text: text.slice(0, 4096), voice: macVoice })
      return
    }

    // Tier 3: Web Speech API with best available local voice
    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = settings.voiceLanguage ?? 'en-US'
      const preferred = ['Zoe', 'Nicky', 'Samantha', 'Karen', 'Moira', 'Tessa']
      const voices = window.speechSynthesis.getVoices()
      const best = preferred
        .flatMap(name => voices.filter(v => v.name.includes(name)))
        .find(Boolean)
        ?? voices.find(v => v.localService && v.lang.startsWith('en'))
      if (best) utterance.voice = best
      utterance.rate = 1.0
      utterance.pitch = 1.0
      window.speechSynthesis.speak(utterance)
    }
  }, [settings.voiceLanguage, settings.openaiApiKey, settings.ttsVoice])

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    if (isTauri()) {
      void invokeTauri('stop_speaking')
    } else if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  return { state, error, isSupported, startListening, stopListening, speak, stopSpeaking }
}

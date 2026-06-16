'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/lib/settings/context'

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

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = settings.voiceLanguage ?? 'en-US'
    window.speechSynthesis.speak(utterance)
  }, [settings.voiceLanguage])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  return { state, error, isSupported, startListening, stopListening, speak, stopSpeaking }
}

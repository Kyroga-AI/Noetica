'use client'

import { useCallback, useRef, useState } from 'react'

export type RealtimeVoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error'

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17'
const SAMPLE_RATE = 24000

// PCM Float32 → Int16 little-endian, returns base64
function float32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Base64 PCM16 → Float32 for AudioContext playback
function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768
  return float32
}

export function useRealtimeVoice(
  onTranscriptComplete?: (text: string) => void,
  onSpeechStart?: () => void,
) {
  const [status, setStatus] = useState<RealtimeVoiceStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  // Playback scheduling state
  const playbackTimeRef = useRef<number>(0)
  // User's own speech transcription (conversation.item.input_audio_transcription.completed)
  const userTranscriptRef = useRef<string>('')
  // AI response transcript (response.audio_transcript.delta) — display only
  const aiTranscriptRef = useRef<string>('')

  const stopSession = useCallback(() => {
    // Stop mic
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    processorRef.current = null
    sourceRef.current = null
    streamRef.current = null

    // Close WebSocket
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close()
    }
    wsRef.current = null

    // Close AudioContext
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null

    setStatus('idle')
    setTranscript('')
    userTranscriptRef.current = ''
    aiTranscriptRef.current = ''
  }, [])

  const startSession = useCallback(async (apiKey: string) => {
    if (!apiKey.trim()) {
      setError('OpenAI API key required for real-time voice.')
      setStatus('error')
      return
    }

    setStatus('connecting')
    setError(null)
    setTranscript('')
    userTranscriptRef.current = ''
    aiTranscriptRef.current = ''

    // Create WebSocket
    const ws = new WebSocket(REALTIME_URL, [
      'realtime',
      `openai-insecure-api-key.${apiKey}`,
      'openai-beta.realtime-v1',
    ])
    wsRef.current = ws

    ws.onopen = async () => {
      // Configure session
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 700 },
        },
      }))

      // Set up AudioContext and microphone
      try {
        const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
        audioCtxRef.current = audioCtx
        playbackTimeRef.current = audioCtx.currentTime

        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        streamRef.current = mediaStream

        const source = audioCtx.createMediaStreamSource(mediaStream)
        sourceRef.current = source

        // ScriptProcessorNode captures PCM chunks
        const bufferSize = 4096
        const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1)
        processorRef.current = processor

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return
          const inputData = e.inputBuffer.getChannelData(0)
          const b64 = float32ToBase64(inputData)
          ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }))
        }

        source.connect(processor)
        processor.connect(audioCtx.destination)

        setStatus('listening')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Microphone access denied')
        setStatus('error')
        ws.close()
      }
    }

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(event.data as string) as Record<string, unknown> }
      catch { return }

      const type = msg['type'] as string | undefined

      if (type === 'response.audio.delta') {
        const delta = msg['delta'] as string | undefined
        if (delta && audioCtxRef.current) {
          setStatus('speaking')
          const audioCtx = audioCtxRef.current
          const float32 = base64ToFloat32(delta)
          const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE)
          buffer.getChannelData(0).set(float32)

          const bufferSource = audioCtx.createBufferSource()
          bufferSource.buffer = buffer
          bufferSource.connect(audioCtx.destination)

          const now = audioCtx.currentTime
          const startAt = Math.max(now, playbackTimeRef.current)
          bufferSource.start(startAt)
          playbackTimeRef.current = startAt + buffer.duration
        }
      }

      // AI response transcript — shown in bubble, not sent as a message
      if (type === 'response.audio_transcript.delta') {
        const delta = msg['delta'] as string | undefined
        if (delta) {
          aiTranscriptRef.current += delta
          setTranscript(aiTranscriptRef.current)
        }
      }

      if (type === 'response.done') {
        // Clear AI transcript bubble after playback finishes
        const audioCtx = audioCtxRef.current
        const remaining = audioCtx ? Math.max(0, playbackTimeRef.current - audioCtx.currentTime) : 0
        setTimeout(() => {
          aiTranscriptRef.current = ''
          setTranscript('')
          if (wsRef.current?.readyState === WebSocket.OPEN) setStatus('listening')
        }, remaining * 1000 + 200)
      }

      // User's own speech transcript — this is what we send to the chat
      if (type === 'conversation.item.input_audio_transcription.completed') {
        const text = (msg['transcript'] as string | undefined)?.trim() ?? ''
        if (text) {
          userTranscriptRef.current = text
          onTranscriptComplete?.(text)
        }
      }

      if (type === 'error') {
        const errMsg = (msg['error'] as { message?: string } | undefined)?.message ?? 'Realtime API error'
        setError(errMsg)
        setStatus('error')
      }

      if (type === 'input_audio_buffer.speech_started') {
        // User started speaking — cancel any ongoing TTS from the basic voice path
        onSpeechStart?.()
        setStatus('listening')
      }
      if (type === 'input_audio_buffer.speech_stopped') setStatus('speaking')
    }

    ws.onerror = () => {
      setError('WebSocket connection failed. Check your API key and network.')
      setStatus('error')
    }

    ws.onclose = () => {
      if (status !== 'error') setStatus('idle')
    }
  }, [onTranscriptComplete, onSpeechStart, status])

  const isSupported =
    typeof window !== 'undefined' &&
    'AudioContext' in window &&
    'mediaDevices' in navigator

  return { status, transcript, error, startSession, stopSession, isSupported }
}

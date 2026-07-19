'use client'

import { useRealtimeVoice } from '@/lib/voice/useRealtimeVoice'

type Props = {
  apiKey?: string
  onTranscript?: (text: string) => void
  onSpeechStart?: () => void
}

export function RealtimeVoiceButton({ apiKey, onTranscript, onSpeechStart }: Props) {
  const { status, transcript, error, startSession, stopSession, isSupported } = useRealtimeVoice(onTranscript, onSpeechStart)

  if (!isSupported) return null

  const isActive = status !== 'idle' && status !== 'error'

  const statusColors = {
    idle:       { ring: '', bg: 'bg-[var(--color-background-secondary)]', icon: 'text-[var(--color-text-secondary)]' },
    connecting: { ring: 'ring-2 ring-[#fbbf24] ring-offset-1 animate-pulse', bg: 'bg-[var(--color-attention-bg)]', icon: 'text-[var(--color-attention)]' },
    listening:  { ring: 'ring-2 ring-[#3b82f6] ring-offset-1', bg: 'bg-[#dbeafe]', icon: 'text-[#1d4ed8]' },
    speaking:   { ring: 'ring-2 ring-[var(--color-accent)] ring-offset-1', bg: 'bg-[var(--color-accent-bg)]', icon: 'text-[var(--color-accent)]' },
    error:      { ring: 'ring-2 ring-[#ef4444] ring-offset-1', bg: 'bg-[#fef2f2]', icon: 'text-[#dc2626]' },
  }[status]

  const labelMap = {
    idle:       'Real-time voice',
    connecting: 'Connecting…',
    listening:  'Listening',
    speaking:   'Speaking',
    error:      error ?? 'Error',
  }

  function handleClick() {
    if (isActive) {
      stopSession()
    } else {
      void startSession(apiKey ?? '')
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Transcript bubble */}
      {transcript && (
        <div className="max-w-[240px] rounded-xl border border-[#bfdbfe] bg-white px-3 py-2 text-xs text-[var(--color-text-primary)] shadow-sm">
          <span className="italic text-[var(--color-text-secondary)]">{transcript}</span>
        </div>
      )}

      {/* Error bubble */}
      {status === 'error' && error && (
        <div className="max-w-[240px] rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">
          {error}
        </div>
      )}

      {/* Main button */}
      <button
        onClick={handleClick}
        title={labelMap[status]}
        className={`flex items-center gap-2 rounded-full border border-[var(--color-border-secondary)] px-3 py-1.5 text-xs font-medium transition ${statusColors.bg} ${statusColors.ring}`}
      >
        {/* Waveform/mic icon */}
        <span className={`relative flex items-center justify-center ${statusColors.icon}`}>
          {status === 'listening' ? (
            // Animated waveform bars
            <span className="flex items-end gap-0.5 h-4">
              {[3, 5, 4, 6, 3].map((h, i) => (
                <span
                  key={i}
                  className="w-0.5 rounded-full bg-current"
                  style={{
                    height: `${h}px`,
                    animation: `bounce 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                  }}
                />
              ))}
            </span>
          ) : status === 'speaking' ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 4.5h2l2-3 2 8 2-5 1 2h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : status === 'connecting' ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="animate-spin" aria-hidden>
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="12 20" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <rect x="4.5" y="1" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2 7.5A5 5 0 0 0 12 7.5M7 12v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          )}
        </span>

        <span className={statusColors.icon}>{labelMap[status]}</span>

        {isActive && (
          <span className="ml-0.5 text-[var(--color-text-tertiary)] hover:text-[#ef4444]">✕</span>
        )}
      </button>

      <style>{`
        @keyframes bounce {
          from { transform: scaleY(0.6); }
          to   { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  )
}

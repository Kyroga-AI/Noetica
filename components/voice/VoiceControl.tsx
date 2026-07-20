'use client'

// Live conversation — the top-bar control. Dictation moved to the composer (bottom bar); this button
// is now single-purpose: start / stop a LIVE voice session. Live is a *metachat* — a real-time voice
// channel layered over the current chat that can act in it or talk about it, without writing into the
// transcript. Idle → a static waveform (the mark for "live"); active → the waveform animates + pulses.
type Props = {
  isLive?: boolean
  onLiveStart?: () => void
  onLiveStop?: () => void
}

export function VoiceControl({ isLive, onLiveStart, onLiveStop }: Props) {
  return (
    <button
      onClick={() => (isLive ? onLiveStop?.() : onLiveStart?.())}
      title={isLive ? 'Live conversation on — click to stop' : 'Start a live conversation (voice, hands-free)'}
      aria-label={isLive ? 'Stop live conversation' : 'Start live conversation'}
      className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border transition ${
        isLive
          ? 'border-[#6366f1] bg-[#eef2ff] text-[#4f46e5]'
          : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
      }`}
    >
      {isLive && <span className="absolute inset-0 rounded-full bg-[#a5b4fc] opacity-30 animate-ping" />}
      {isLive ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.2" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="4;9;4" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="6;3.5;6" dur="0.8s" repeatCount="indefinite"/></rect>
          <rect x="5.4" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="8;3;8" dur="0.7s" repeatCount="indefinite"/><animate attributeName="y" values="4;6.5;4" dur="0.7s" repeatCount="indefinite"/></rect>
          <rect x="8.6" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="6;11;6" dur="0.9s" repeatCount="indefinite"/><animate attributeName="y" values="5;2.5;5" dur="0.9s" repeatCount="indefinite"/></rect>
          <rect x="11.8" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="4;7;4" dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="6;4.5;6" dur="0.6s" repeatCount="indefinite"/></rect>
        </svg>
      ) : (
        // Static waveform — the resting "live" mark.
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.2" y="6" width="1.6" height="4" rx="0.8" fill="currentColor"/>
          <rect x="5.4" y="4" width="1.6" height="8" rx="0.8" fill="currentColor"/>
          <rect x="8.6" y="5" width="1.6" height="6" rx="0.8" fill="currentColor"/>
          <rect x="11.8" y="6.5" width="1.6" height="3" rx="0.8" fill="currentColor"/>
        </svg>
      )}
    </button>
  )
}

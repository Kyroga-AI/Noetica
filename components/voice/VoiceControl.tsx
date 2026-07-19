'use client'

import { useState } from 'react'
import type { VoiceState } from '@/lib/voice/useVoice'

// One voice control replacing the two near-identical topbar buttons (mic dictation + live waveform).
// Idle → click opens a small picker (Dictate one turn / Live conversation). Active → the button shows
// the running mode (mic pulse or waveform) and click stops it.
type Props = {
  voiceState?: VoiceState
  isLive?: boolean
  onVoiceStart?: () => void
  onVoiceStop?: () => void
  onLiveStart?: () => void
  onLiveStop?: () => void
}

export function VoiceControl({ voiceState, isLive, onVoiceStart, onVoiceStop, onLiveStart, onLiveStop }: Props) {
  const [open, setOpen] = useState(false)
  const listening = voiceState === 'listening' && !isLive
  const active = listening || !!isLive

  function onButtonClick() {
    if (isLive) { onLiveStop?.(); return }
    if (listening) { onVoiceStop?.(); return }
    setOpen((v) => !v)
  }

  return (
    <div className="relative">
      <button
        onClick={onButtonClick}
        title={isLive ? 'Live chat on — click to stop' : listening ? 'Listening… click to stop' : 'Voice — dictate or start a live conversation'}
        aria-label="Voice"
        className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border transition ${
          isLive     ? 'border-[#6366f1] bg-[#eef2ff] text-[#4f46e5]'
          : listening ? 'border-[#f43f5e] bg-[#fff1f2] text-[#f43f5e]'
          : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
        }`}
      >
        {active && <span className={`absolute inset-0 rounded-full animate-ping ${isLive ? 'bg-[#a5b4fc]' : 'bg-[#fda4af]'} opacity-30`} />}
        {isLive ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2.2" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="4;9;4" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="6;3.5;6" dur="0.8s" repeatCount="indefinite"/></rect>
            <rect x="5.4" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="8;3;8" dur="0.7s" repeatCount="indefinite"/><animate attributeName="y" values="4;6.5;4" dur="0.7s" repeatCount="indefinite"/></rect>
            <rect x="8.6" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="6;11;6" dur="0.9s" repeatCount="indefinite"/><animate attributeName="y" values="5;2.5;5" dur="0.9s" repeatCount="indefinite"/></rect>
            <rect x="11.8" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="4;7;4" dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="6;4.5;6" dur="0.6s" repeatCount="indefinite"/></rect>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="6" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M3 8a5 5 0 0 0 10 0M8 13v2M6 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>

      {open && !active && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] shadow-lg">
            <button
              onClick={() => { setOpen(false); onVoiceStart?.() }}
              className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-[var(--color-background-secondary)]">
              <span className="text-[12px] font-medium text-[var(--color-text-primary)]">Dictate</span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Speak one message, then it sends</span>
            </button>
            <button
              onClick={() => { setOpen(false); onLiveStart?.() }}
              className="flex w-full flex-col items-start border-t border-[var(--color-border-tertiary)] px-3 py-2 text-left transition hover:bg-[var(--color-background-secondary)]">
              <span className="text-[12px] font-medium text-[var(--color-text-primary)]">Live conversation</span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Hands-free back-and-forth</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

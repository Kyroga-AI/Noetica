import { NoeticaMark } from '@/components/brand/NoeticaMark'
import { WarmingLevel } from '@/components/risk/WarmingLevel'
import { ThemePicker } from '@/components/shell/ThemePicker'
import { RuntimeStatus } from '@/components/status/RuntimeStatus'
import { RealtimeVoiceButton } from '@/components/voice/RealtimeVoiceButton'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import type { VoiceState } from '@/lib/voice/useVoice'

type TopbarProps = {
  modelId: string
  mode: 'standalone' | 'sourceos'
  riskReadout?: RiskAversionLiveReadout | null
  voiceState?: VoiceState
  openaiApiKey?: string
  hasMessages?: boolean
  onModelChange: (modelId: string) => void
  onModeChange: (mode: 'standalone' | 'sourceos') => void
  onOpenSettings: (category?: string) => void
  onOpenPalette: () => void
  onOpenInspector?: () => void
  onExportConversation?: () => void
  onVoiceStart?: () => void
  onVoiceStop?: () => void
  onRealtimeTranscript?: (text: string) => void
  onRealtimeSpeechStart?: () => void
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function Topbar({ modelId, mode, riskReadout, voiceState, openaiApiKey, hasMessages, onModelChange, onModeChange, onOpenSettings, onOpenPalette, onOpenInspector, onExportConversation, onVoiceStart, onVoiceStop, onRealtimeTranscript, onRealtimeSpeechStart }: TopbarProps) {
  const isListening = voiceState === 'listening'

  return (
    <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background-primary)]">
          <NoeticaMark className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">Noetica</span>
      </div>

      <div className="flex items-center gap-2">
        <RuntimeStatus />
        {/* Basic STT voice button — compact, salmon pink */}
        <button
          onClick={isListening ? onVoiceStop : onVoiceStart}
          title={isListening ? 'Listening… click to stop' : 'Speak to Claude'}
          aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
          className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border transition ${
            isListening
              ? 'border-[#fda4af] bg-[#fff1f2] text-[#f43f5e]'
              : 'border-[#fda4af] bg-[#fff1f2] text-[#fb7185] hover:bg-[#ffe4e6]'
          }`}
        >
          {isListening && (
            <span className="absolute inset-0 rounded-full animate-ping bg-[#fda4af] opacity-30" />
          )}
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="6" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M3 8a5 5 0 0 0 10 0M8 13v2M6 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        {/* Real-time voice (OpenAI Realtime API) — only shown when API key is available */}
        {openaiApiKey && (
          <RealtimeVoiceButton apiKey={openaiApiKey} onTranscript={onRealtimeTranscript} onSpeechStart={onRealtimeSpeechStart} />
        )}
        <WarmingLevel readout={riskReadout} onOpenInspector={onOpenInspector} />
        <ThemePicker />
        {hasMessages && onExportConversation && (
          <button
            onClick={onExportConversation}
            style={{ border: 'none', background: 'none' }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]"
            aria-label="Export conversation"
            title="Export conversation"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1v9M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <button
          onClick={onOpenPalette}
          style={{ border: 'none', background: 'none' }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]"
          aria-label="Command palette (⌘K)"
          title="Command palette (⌘K)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => onOpenSettings()}
          style={{ border: 'none', background: 'none' }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]"
          aria-label="Settings (⌘,)"
          title="Settings (⌘,)"
        >
          <IconSettings />
        </button>
      </div>
    </header>
  )
}

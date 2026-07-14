import { isTauri } from '@/lib/tauri/bridge'
import { NoeticaMark } from '@/components/brand/NoeticaMark'
import { WarmingLevel } from '@/components/risk/WarmingLevel'
import { ThemePicker } from '@/components/shell/ThemePicker'
import { RuntimeStatus } from '@/components/status/RuntimeStatus'
import { EgressMeter } from '@/components/status/EgressMeter'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import type { VoiceState } from '@/lib/voice/useVoice'

type TopbarProps = {
  modelId: string
  mode: 'standalone' | 'sourceos'
  riskReadout?: RiskAversionLiveReadout | null
  voiceState?: VoiceState
  isLive?: boolean
  onLiveStart?: () => void
  onLiveStop?: () => void
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

export function Topbar({ modelId, mode, riskReadout, voiceState, isLive, onLiveStart, onLiveStop, openaiApiKey, hasMessages, onModelChange, onModeChange, onOpenSettings, onOpenPalette, onOpenInspector, onExportConversation, onVoiceStart, onVoiceStop, onRealtimeTranscript, onRealtimeSpeechStart }: TopbarProps) {
  const isListening = voiceState === 'listening'

  // Double-click the titlebar to zoom/maximize (native macOS behavior the Overlay titlebar drops).
  // Ignore double-clicks that land on a control so e.g. double-tapping Settings doesn't also maximize.
  async function onTitlebarDoubleClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) return
    if (!isTauri()) return
    try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().toggleMaximize() }
    catch { /* not in a Tauri window */ }
  }

  return (
    // Unified titlebar (Claude-style): the macOS window uses an Overlay titlebar (transparent, traffic
    // lights float over content), so THIS bar IS the titlebar — draggable, and padded left so the brand
    // clears the floating traffic lights. `data-tauri-drag-region` lets you move the window by the bar;
    // the buttons inside stay clickable (Tauri excludes interactive children from the drag).
    // The 78px reservation only applies below lg: at lg+, CommandCenterRail (+ Sidebar/CollapsedRail —
    // same lg: gate) already sits to the left of this bar and clears the traffic lights itself, so
    // keeping the full 78px here too just steals width from the title, squeezing it against the
    // egress/runtime pills on narrower lg+ windows. pl-4 there is purely cosmetic edge spacing.
    <header
      data-tauri-drag-region
      onDoubleClick={onTitlebarDoubleClick}
      className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] pl-[78px] pr-4 lg:pl-4"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background-primary)]">
          <NoeticaMark className="h-3.5 w-3.5" />
        </div>
        <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">Noetica</span>
      </div>

      {/* shrink-0 so the status pills + actions keep their size; the title (min-w-0 + truncate
          above) gives way instead, so nothing overlaps when the rail panels narrow the bar. */}
      <div className="flex shrink-0 items-center gap-2">
        <EgressMeter />
        <RuntimeStatus />
        {/* Mic — push-to-talk dictation (single turn). Stays a mic. */}
        <button
          onClick={isListening && !isLive ? onVoiceStop : onVoiceStart}
          title={isListening && !isLive ? 'Listening… click to stop' : 'Speak (dictate)'}
          aria-label="Voice dictation"
          className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border transition ${
            isListening && !isLive ? 'border-[#f43f5e] bg-[#fff1f2] text-[#f43f5e]' : 'border-[#fda4af] bg-[#fff1f2] text-[#fb7185] hover:bg-[#ffe4e6]'
          }`}
        >
          {isListening && !isLive && <span className="absolute inset-0 rounded-full animate-ping bg-[#fda4af] opacity-30" />}
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="6" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M3 8a5 5 0 0 0 10 0M8 13v2M6 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        {/* Live chat — continuous hands-free conversation (waveform), fully local. */}
        <button
          onClick={isLive ? onLiveStop : onLiveStart}
          title={isLive ? 'Live chat on — click to stop' : 'Start live voice chat'}
          aria-label="Live voice chat"
          className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full border transition ${
            isLive ? 'border-[#6366f1] bg-[#eef2ff] text-[#4f46e5]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          {isLive && <span className="absolute inset-0 rounded-full animate-ping bg-[#a5b4fc] opacity-30" />}
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            {isLive ? (
              <>
                <rect x="2.2" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="4;9;4" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="6;3.5;6" dur="0.8s" repeatCount="indefinite"/></rect>
                <rect x="5.4" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="8;3;8" dur="0.7s" repeatCount="indefinite"/><animate attributeName="y" values="4;6.5;4" dur="0.7s" repeatCount="indefinite"/></rect>
                <rect x="8.6" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="6;11;6" dur="0.9s" repeatCount="indefinite"/><animate attributeName="y" values="5;2.5;5" dur="0.9s" repeatCount="indefinite"/></rect>
                <rect x="11.8" width="1.6" rx="0.8" fill="currentColor"><animate attributeName="height" values="4;7;4" dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="6;4.5;6" dur="0.6s" repeatCount="indefinite"/></rect>
              </>
            ) : (
              <>
                <rect x="2.2" y="6" width="1.6" height="4" rx="0.8" fill="currentColor"/>
                <rect x="5.4" y="4" width="1.6" height="8" rx="0.8" fill="currentColor"/>
                <rect x="8.6" y="5" width="1.6" height="6" rx="0.8" fill="currentColor"/>
                <rect x="11.8" y="6" width="1.6" height="4" rx="0.8" fill="currentColor"/>
              </>
            )}
          </svg>
        </button>
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

import { isTauri } from '@/lib/tauri/bridge'
import { NoeticaMark } from '@/components/brand/NoeticaMark'
import { ThemePicker } from '@/components/shell/ThemePicker'
import { SovereigntyStatus } from '@/components/status/SovereigntyStatus'
import { VoiceControl } from '@/components/voice/VoiceControl'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import type { VoiceState } from '@/lib/voice/useVoice'
import { OpenChatToggle } from '@/components/chat/OpenChatToggle'
import type { WorkspaceSession } from '@/lib/session/types'
import type { PublishResult } from '@/lib/session/commons-client'

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
  activeSession?: WorkspaceSession | null
  onSetVisibility?: (id: string, v: 'private' | 'open') => Promise<PublishResult>
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

export function Topbar({ modelId, mode, riskReadout, voiceState, isLive, onLiveStart, onLiveStop, openaiApiKey, hasMessages, activeSession, onSetVisibility, onModelChange, onModeChange, onOpenSettings, onOpenPalette, onOpenInspector, onExportConversation, onVoiceStart, onVoiceStop, onRealtimeTranscript, onRealtimeSpeechStart }: TopbarProps) {
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
    <header
      data-tauri-drag-region
      onDoubleClick={onTitlebarDoubleClick}
      className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] pl-[78px] pr-4"
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
        {/* One consolidated health indicator (egress · runtime · risk) — replaces three separate pills. */}
        <SovereigntyStatus riskReadout={riskReadout} onOpenInspector={onOpenInspector} />
        {/* One voice control — dictate or live, picked from its own menu. */}
        <VoiceControl
          voiceState={voiceState}
          isLive={isLive}
          onVoiceStart={onVoiceStart}
          onVoiceStop={onVoiceStop}
          onLiveStart={onLiveStart}
          onLiveStop={onLiveStop}
        />
        {hasMessages && activeSession && onSetVisibility && (
          <OpenChatToggle session={activeSession} onSetVisibility={onSetVisibility} />
        )}
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

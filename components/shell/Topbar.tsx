import { RuntimeStatus } from '@/components/status/RuntimeStatus'
import { ModelPicker } from '@/components/providers/ModelPicker'
import { models } from '@/config/models'

type TopbarProps = {
  modelId: string
  mode: 'standalone' | 'sourceos'
  onModelChange: (modelId: string) => void
  onModeChange: (mode: 'standalone' | 'sourceos') => void
  onOpenSettings: () => void
  onOpenPalette: () => void
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function Topbar({ modelId, mode, onModelChange, onModeChange, onOpenSettings, onOpenPalette }: TopbarProps) {
  const model = models.find((candidate) => candidate.id === modelId) ?? models[0]

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#d7dee8] bg-[#f3f6fa]/95 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-[#0f172a] text-sm font-semibold text-white sm:flex">
          N
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#0f172a]">Noetica</div>
          <div className="truncate text-xs text-[#64748b]">{model.label}</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <div className="w-full max-w-md">
          <ModelPicker value={modelId} onChange={onModelChange} />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <RuntimeStatus />
        <select
          className="rounded-full border border-[#bfdbfe] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] outline-none transition hover:bg-[#eff6ff]"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as 'standalone' | 'sourceos')}
          aria-label="Runtime mode"
        >
          <option value="standalone">Standalone</option>
          <option value="sourceos">SourceOS</option>
        </select>
        <button
          onClick={onOpenPalette}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#bfdbfe] bg-white text-[#64748b] transition hover:bg-[#eff6ff] hover:text-[#0f172a]"
          aria-label="Command palette (⌘K)"
          title="Command palette (⌘K)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#bfdbfe] bg-white text-[#64748b] transition hover:bg-[#eff6ff] hover:text-[#0f172a]"
          aria-label="Settings (⌘,)"
          title="Settings (⌘,)"
        >
          <IconSettings />
        </button>
      </div>
    </header>
  )
}

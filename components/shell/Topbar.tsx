import { RuntimeStatus } from '@/components/status/RuntimeStatus'
import { ModelPicker } from '@/components/providers/ModelPicker'
import { models } from '@/config/models'

type TopbarProps = {
  modelId: string
  mode: 'standalone' | 'sourceos'
  onModelChange: (modelId: string) => void
  onModeChange: (mode: 'standalone' | 'sourceos') => void
}

export function Topbar({ modelId, mode, onModelChange, onModeChange }: TopbarProps) {
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

      <div className="flex items-center gap-2">
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
      </div>
    </header>
  )
}

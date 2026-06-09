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
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#e7e0d8] bg-[#f7f3ec]/95 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-[#2f261d] text-sm font-semibold text-[#f7f3ec] sm:flex">
          N
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1f1b16]">Noetica</div>
          <div className="truncate text-xs text-[#7d746b]">{model.label}</div>
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
          className="rounded-full border border-[#d8ccbd] bg-[#fcfaf7] px-3 py-1.5 text-xs font-medium text-[#4f463d] outline-none transition hover:bg-white"
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

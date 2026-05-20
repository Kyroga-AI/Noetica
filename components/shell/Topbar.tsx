import { ModelPicker } from '@/components/providers/ModelPicker'

type TopbarProps = {
  modelId: string
  mode: 'standalone' | 'sourceos'
  onModelChange: (modelId: string) => void
  onModeChange: (mode: 'standalone' | 'sourceos') => void
}

export function Topbar({ modelId, mode, onModelChange, onModeChange }: TopbarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-noetica-line bg-white px-5">
      <div>
        <div className="text-sm font-semibold text-slate-950">Governed Chat Surface</div>
        <div className="text-xs text-slate-500">Routing, policy, steering, and memory scope stay visible.</div>
      </div>
      <div className="flex items-center gap-3">
        <select
          className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as 'standalone' | 'sourceos')}
        >
          <option value="standalone">standalone</option>
          <option value="sourceos">sourceos</option>
        </select>
        <ModelPicker value={modelId} onChange={onModelChange} />
      </div>
    </header>
  )
}

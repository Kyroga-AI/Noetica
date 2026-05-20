import { ModelPicker } from '@/components/providers/ModelPicker'
import { models } from '@/config/models'

type TopbarProps = {
  modelId: string
  mode: 'standalone' | 'sourceos'
  onModelChange: (modelId: string) => void
  onModeChange: (mode: 'standalone' | 'sourceos') => void
}

const badgeByProvider: Record<string, string> = {
  anthropic: 'bg-violet-50 text-violet-700 border-violet-200',
  openai: 'bg-green-50 text-green-700 border-green-200',
  neuronpedia: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  google: 'bg-sky-50 text-sky-700 border-sky-200',
  meta: 'bg-orange-50 text-orange-700 border-orange-200',
  mistral: 'bg-rose-50 text-rose-700 border-rose-200',
  xai: 'bg-slate-50 text-slate-700 border-slate-200'
}

export function Topbar({ modelId, mode, onModelChange, onModeChange }: TopbarProps) {
  const model = models.find((candidate) => candidate.id === modelId) ?? models[0]
  const badgeClass = badgeByProvider[model.provider] ?? badgeByProvider.xai

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-noetica-line bg-white px-5">
      <div className="min-w-0 flex-1">
        <ModelPicker value={modelId} onChange={onModelChange} />
      </div>
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>{model.provider}</span>
      <select
        className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700"
        value={mode}
        onChange={(event) => onModeChange(event.target.value as 'standalone' | 'sourceos')}
      >
        <option value="standalone">standalone</option>
        <option value="sourceos">sourceos</option>
      </select>
    </header>
  )
}

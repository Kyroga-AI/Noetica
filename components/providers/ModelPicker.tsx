import { models } from '@/config/models'

type ModelPickerProps = {
  value: string
  onChange: (modelId: string) => void
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  return (
    <select
      className="min-w-64 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.provider} / {model.label}
        </option>
      ))}
    </select>
  )
}

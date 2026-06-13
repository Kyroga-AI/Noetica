import { models } from '@/config/models'
import type { Provider } from '@/lib/types/model'

type ModelPickerProps = {
  value: string
  onChange: (modelId: string) => void
}

const providerOrder: Provider[] = ['neuronpedia', 'anthropic', 'openai', 'google', 'meta', 'mistral', 'xai']
const providerLabel: Record<Provider, string> = {
  neuronpedia: 'Neuronpedia / full SAE',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  meta: 'Meta / local path',
  mistral: 'Mistral',
  xai: 'xAI'
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  return (
    <select
      className="w-full max-w-md rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {providerOrder.map((provider) => {
        const providerModels = models.filter((model) => model.provider === provider)
        if (!providerModels.length) return null

        return (
          <optgroup key={provider} label={`— ${providerLabel[provider]} —`}>
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}

'use client'

import { visibleModels } from '@/config/models'
import { useSettings } from '@/lib/settings/context'
import type { Provider } from '@/lib/types/model'

type ModelPickerProps = {
  value: string
  onChange: (modelId: string) => void
}

const providerOrder: Provider[] = ['meta', 'anthropic', 'openai', 'google', 'mistral', 'xai', 'neuronpedia']
const providerLabel: Record<Provider, string> = {
  meta: 'Local (Ollama)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  mistral: 'Mistral',
  xai: 'xAI',
  neuronpedia: 'Neuronpedia / SAE',
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const { settings } = useSettings()
  const modelList = visibleModels(settings.showAllModels)

  return (
    <select
      className="w-full max-w-md rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {providerOrder.map((provider) => {
        const providerModels = modelList.filter((model) => model.provider === provider)
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

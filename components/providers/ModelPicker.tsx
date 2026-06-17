'use client'

import { useEffect, useState } from 'react'
import { visibleModels } from '@/config/models'
import { useSettings } from '@/lib/settings/context'
import { isTauri } from '@/lib/tauri/bridge'
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

function amBase() { return isTauri() ? 'http://127.0.0.1:8080' : '' }

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const { settings } = useSettings()
  const modelList = visibleModels(settings.showAllModels)
  const [pulledModels, setPulledModels] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`${amBase()}/api/models`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((data: { models?: Array<{ name: string; pulled: boolean }> } | null) => {
        if (data?.models) {
          setPulledModels(new Set(data.models.filter(m => m.pulled).map(m => m.name)))
        }
      })
      .catch(() => { /* agent-machine not running */ })
  }, [])

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
            {providerModels.map((model) => {
              const isLocal = model.provider === 'meta' && model.id !== 'auto'
              const notPulled = isLocal && pulledModels.size > 0 && !pulledModels.has(model.id)
              return (
                <option key={model.id} value={model.id}>
                  {model.label}{notPulled ? ' (not installed)' : ''}
                </option>
              )
            })}
          </optgroup>
        )
      })}
    </select>
  )
}

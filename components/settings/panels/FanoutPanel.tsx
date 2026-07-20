'use client'

import { models } from '@/config/models'
import { useSettings } from '@/lib/settings/context'

const MODEL_FAMILY_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  mistral: 'Mistral',
  neuronpedia: 'Neuronpedia (SAE)',
  meta: 'Meta (local)',
}

export function FanoutPanel() {
  const { settings, update } = useSettings()

  function toggleModel(id: string) {
    const current = settings.fanoutModels
    const next = current.includes(id)
      ? current.filter((m) => m !== id)
      : [...current, id]
    update({ fanoutModels: next })
  }

  const byFamily = models.reduce<Record<string, typeof models>>((acc, m) => {
    const key = m.provider
    acc[key] = [...(acc[key] ?? []), m]
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Fan-out models</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          When fan-out mode is active in a chat, your prompt is sent to all selected models in parallel. Each response appears as a labelled bubble in the same thread.
        </p>
      </div>

      <div className="space-y-4">
        {Object.entries(byFamily).map(([provider, providerModels]) => (
          <div key={provider}>
            <div className="mb-2 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
              {MODEL_FAMILY_LABELS[provider] ?? provider}
            </div>
            <div className="space-y-1.5">
              {providerModels.map((m) => {
                const checked = settings.fanoutModels.includes(m.id)
                return (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                      checked
                        ? 'border-[#bfdbfe] bg-[#eff6ff]'
                        : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:border-[#bfdbfe]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#1d4ed8]"
                      checked={checked}
                      onChange={() => toggleModel(m.id)}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">{m.label}</div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{m.description}</div>
                      {m.extended_thinking && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-medium text-[#1d4ed8]">
                          Extended thinking
                        </div>
                      )}
                      {m.steering !== 'none' && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                          SAE steering: {m.steering}
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Concurrency limit</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          Maximum parallel requests when fanning out. Higher values are faster but consume more API quota.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={settings.fanoutConcurrency}
            className="flex-1 accent-[#1d4ed8]"
            onChange={(e) => update({ fanoutConcurrency: Number(e.target.value) })}
          />
          <span className="w-6 text-center text-sm font-semibold text-[var(--color-text-primary)]">
            {settings.fanoutConcurrency}
          </span>
        </div>
      </div>

      {settings.fanoutModels.length === 0 && (
        <div className="rounded-xl border border-[#fef08a] bg-[var(--color-attention-bg)] p-3 text-xs text-[#713f12]">
          No models selected — fan-out sends are disabled until at least one model is chosen.
        </div>
      )}
    </div>
  )
}

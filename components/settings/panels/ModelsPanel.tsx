'use client'

import { useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { visibleModels } from '@/config/models'
import { ProviderSetupModal } from '@/components/shell/ProviderSetupModal'

function MaskedInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--color-text-secondary)]">{label}</label>
      <div className="mt-1.5 flex gap-2">
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-…"
          className="flex-1 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
        />
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

export function ModelsPanel() {
  const { settings, update } = useSettings()
  const [setupOpen, setSetupOpen] = useState(false)
  const modelList = visibleModels(settings.showAllModels)

  return (
    <div className="space-y-6">
      {setupOpen && <ProviderSetupModal onClose={() => setSetupOpen(false)} />}

      <div className="flex items-center justify-between rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Show all models</div>
          <div className="text-xs text-[var(--color-text-secondary)]">Includes cloud, Neuronpedia, and SAE-target models. Local Ollama models are always shown.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.showAllModels}
          onClick={() => update({ showAllModels: !settings.showAllModels })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${settings.showAllModels ? 'bg-[#1d4ed8]' : 'bg-[var(--color-border-secondary)]'}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${settings.showAllModels ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Default model</label>
        <select
          value={settings.defaultModelId}
          onChange={(e) => update({ defaultModelId: e.target.value })}
          className="mt-3 w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
        >
          {modelList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.provider}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Provider API keys</div>
          <button
            onClick={() => setSetupOpen(true)}
            className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]"
          >
            Setup guide
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">Keys are stored in browser localStorage. Do not use on shared machines.</p>
        <MaskedInput label="Anthropic" value={settings.anthropicApiKey} onChange={(v) => update({ anthropicApiKey: v })} />
        <MaskedInput label="OpenAI" value={settings.openaiApiKey} onChange={(v) => update({ openaiApiKey: v })} />
        <MaskedInput label="Google (Gemini)" value={settings.googleApiKey} onChange={(v) => update({ googleApiKey: v })} />
        <MaskedInput label="Mistral" value={settings.mistralApiKey} onChange={(v) => update({ mistralApiKey: v })} />
        <MaskedInput label="Neuronpedia" value={settings.neuronpediaApiKey} onChange={(v) => update({ neuronpediaApiKey: v })} />
        <MaskedInput label="Serper (web search)" value={settings.serperApiKey} onChange={(v) => update({ serperApiKey: v })} />
      </div>

      <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs text-[var(--color-text-secondary)] leading-5">
        Keys are forwarded to the local Next.js API route on send — they are never transmitted to third parties beyond the selected provider.
        In Tauri desktop mode the route runs entirely on your machine.
      </div>
    </div>
  )
}

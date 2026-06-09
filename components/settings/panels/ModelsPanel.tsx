'use client'

import { useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { models } from '@/config/models'

function MaskedInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div>
      <label className="block text-xs font-semibold text-[#64748b]">{label}</label>
      <div className="mt-1.5 flex gap-2">
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-…"
          className="flex-1 rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#1d4ed8] focus:bg-white"
        />
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#64748b] transition hover:bg-[#f8fafc]"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

export function ModelsPanel() {
  const { settings, update } = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Default model</label>
        <select
          value={settings.defaultModelId}
          onChange={(e) => update({ defaultModelId: e.target.value })}
          className="mt-3 w-full rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#1d4ed8] focus:bg-white"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.provider}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        <div className="text-sm font-semibold text-[#0f172a]">Provider API keys</div>
        <p className="text-xs text-[#64748b]">Keys are stored in browser localStorage. Do not use on shared machines.</p>
        <MaskedInput
          label="Anthropic"
          value={settings.anthropicApiKey}
          onChange={(v) => update({ anthropicApiKey: v })}
        />
        <MaskedInput
          label="OpenAI"
          value={settings.openaiApiKey}
          onChange={(v) => update({ openaiApiKey: v })}
        />
        <MaskedInput
          label="Google"
          value={settings.googleApiKey}
          onChange={(v) => update({ googleApiKey: v })}
        />
      </div>
    </div>
  )
}

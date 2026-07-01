'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSettings } from '@/lib/settings/context'
import { visibleModels, providersWithKeys } from '@/config/models'
import { ProviderSetupModal } from '@/components/shell/ProviderSetupModal'
import { amUrl } from '@/lib/tauri/bridge'

// --- Types ---

type ModelSuiteEntry = {
  name: string
  role: string
  description: string
  priority: number
  sizeGb: number
  pulled: boolean
  ollamaRunning: boolean
}

type PullState = {
  status: string
  pct: number | null
  done: boolean
  error?: string
}

// --- Role badge colors ---
const ROLE_COLORS: Record<string, string> = {
  conductor:       'bg-[#eff6ff] text-[#1d4ed8] border-[#bfdbfe]',
  general:         'bg-[#f0fdf4] text-[#166534] border-[#bbf7d0]',
  coding:          'bg-[#fdf4ff] text-[#7e22ce] border-[#e9d5ff]',
  reasoning:       'bg-[#fff7ed] text-[#c2410c] border-[#fed7aa]',
  'general-large': 'bg-[#fefce8] text-[#854d0e] border-[#fde68a]',
  uncensored:      'bg-[#fef2f2] text-[#991b1b] border-[#fecaca]',
  vision:          'bg-[#f0f9ff] text-[#0c4a6e] border-[#bae6fd]',
}

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
        <button type="button" onClick={() => setRevealed(r => !r)}
          className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

export function ModelsPanel() {
  const { settings, update } = useSettings()
  const [setupOpen, setSetupOpen] = useState(false)
  const customModels = (settings.customModelIds ?? []).map((id) => ({
    id, label: id,
    provider: id.startsWith('hf.co/') || id.startsWith('huggingface.co/') ? 'local'
      : id.startsWith('openrouter/') ? 'openrouter'
      : id.startsWith('hf/') ? 'huggingface' : 'custom',
  }))
  const modelList = [...visibleModels(settings.showAllModels, providersWithKeys(settings)), ...customModels]
  const [suite, setSuite] = useState<ModelSuiteEntry[]>([])
  const [suiteLoading, setSuiteLoading] = useState(true)
  const [pullStates, setPullStates] = useState<Record<string, PullState>>({})
  const [newModelId, setNewModelId] = useState('')

  const fetchSuite = useCallback(async () => {
    try {
      const res = await fetch(amUrl('/api/models'))
      if (res.ok) setSuite(await res.json().then((d: { models?: ModelSuiteEntry[] }) => d.models ?? []))
    } catch { /* AM not running */ }
    setSuiteLoading(false)
  }, [])

  useEffect(() => { void fetchSuite() }, [fetchSuite])

  function addCustomModel() {
    const id = newModelId.trim()
    if (!id) return
    const existing = settings.customModelIds ?? []
    if (!existing.includes(id)) update({ customModelIds: [...existing, id] })
    // hf.co/… is a local GGUF — pull it into Ollama now. Hosted ids (openrouter/…, hf/…) need no pull.
    if (id.startsWith('hf.co/') || id.startsWith('huggingface.co/')) void pullModelUI(id)
    setNewModelId('')
  }

  async function pullModelUI(name: string) {
    setPullStates(p => ({ ...p, [name]: { status: 'Starting…', pct: null, done: false } }))
    try {
      const res = await fetch(amUrl('/api/models/pull'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: name }),
      })
      if (!res.ok || !res.body) throw new Error('pull failed')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const ev = JSON.parse(line.slice(5)) as PullState & { model: string }
            setPullStates(p => ({ ...p, [name]: ev }))
            if (ev.done && !ev.error) {
              setSuite(s => s.map(m => m.name === name ? { ...m, pulled: true } : m))
            }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setPullStates(p => ({ ...p, [name]: { status: 'error', pct: null, done: true, error: String(e) } }))
    }
  }

  return (
    <div className="space-y-6">
      {setupOpen && <ProviderSetupModal onClose={() => setSetupOpen(false)} />}

      {/* Local model suite */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <label className="text-sm font-semibold text-[var(--color-text-primary)]">Local model suite</label>
          <button onClick={fetchSuite} className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            Refresh
          </button>
        </div>
        {suiteLoading ? (
          <div className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">Checking Ollama…</div>
        ) : suite.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
            Agent Machine not running. Start it to manage local models.
          </div>
        ) : (
          <div className="space-y-2">
            {suite.map(m => {
              const ps = pullStates[m.name]
              const isPulling = ps && !ps.done
              const hasError = ps?.done && ps.error
              return (
                <div key={m.name} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-[var(--color-text-primary)]">{m.name}</span>
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_COLORS[m.role] ?? 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-secondary)]'}`}>
                          {m.role}
                        </span>
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">{m.sizeGb}GB</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">{m.description}</p>
                    </div>
                    <div className="shrink-0">
                      {m.pulled ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-[#16a34a]">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><circle cx="5" cy="5" r="4.5" stroke="currentColor" strokeWidth="1"/><path d="M2.5 5l1.8 1.8L7.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Ready
                        </span>
                      ) : isPulling ? (
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">Pulling…</span>
                      ) : (
                        <button
                          onClick={() => void pullModelUI(m.name)}
                          disabled={!m.ollamaRunning}
                          className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-40"
                        >
                          Pull {m.sizeGb}GB
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Pull progress bar */}
                  {ps && !ps.done && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
                        <span>{ps.status}</span>
                        {ps.pct !== null && <span>{ps.pct}%</span>}
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                        <div
                          className="h-full rounded-full bg-[#1d4ed8] transition-all duration-300"
                          style={{ width: `${ps.pct ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {hasError && (
                    <p className="mt-1 text-[10px] text-[#dc2626]">{ps.error}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Default model picker */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Default model</label>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-[var(--color-text-secondary)]">Auto (prophet-mesh) is recommended — routes per task.</p>
          <button
            onClick={() => update({ showAllModels: !settings.showAllModels })}
            className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            {settings.showAllModels ? 'Fewer' : 'Show all'}
          </button>
        </div>
        <select
          value={settings.defaultModelId}
          onChange={(e) => update({ defaultModelId: e.target.value })}
          className="mt-2 w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
        >
          {modelList.map((m) => (
            <option key={m.id} value={m.id}>{m.label} — {m.provider}</option>
          ))}
        </select>
      </div>

      {/* Add a model — HuggingFace GGUF (local via Ollama) or a hosted aggregator (OpenRouter / HF Inference) */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Add a model</label>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)] leading-5">
          Local: <code className="rounded bg-[var(--color-background-secondary)] px-1">hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M</code> — pulled + run via Ollama, fully local.<br/>
          Hosted: <code className="rounded bg-[var(--color-background-secondary)] px-1">openrouter/meta-llama/llama-3.1-70b-instruct</code> or <code className="rounded bg-[var(--color-background-secondary)] px-1">hf/meta-llama/Llama-3.1-8B-Instruct</code> — needs the matching key above.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustomModel() }}
            placeholder="hf.co/… or openrouter/… or hf/…"
            className="flex-1 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
          />
          <button onClick={addCustomModel} disabled={!newModelId.trim()}
            className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-40">
            Add
          </button>
        </div>
        {customModels.length > 0 && (
          <div className="mt-2 space-y-1">
            {customModels.map((m) => {
              const ps = pullStates[m.id]
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-text-secondary)]">{m.id}</span>
                  <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                    {ps && !ps.done ? `pulling… ${ps.pct != null ? Math.round(ps.pct) + '%' : ps.status}` : ps?.error ? 'pull failed' : m.provider}
                  </span>
                  <button onClick={() => update({ customModelIds: (settings.customModelIds ?? []).filter((x) => x !== m.id) })}
                    title="Remove" className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[#dc2626]">✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Provider API keys */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Provider API keys</div>
          <button onClick={() => setSetupOpen(true)}
            className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
            Setup guide
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">Keys are stored in browser localStorage. Do not use on shared machines.</p>
        <MaskedInput label="Anthropic" value={settings.anthropicApiKey} onChange={(v) => update({ anthropicApiKey: v })} />
        <MaskedInput label="OpenAI" value={settings.openaiApiKey} onChange={(v) => update({ openaiApiKey: v })} />
        <MaskedInput label="Google (Gemini)" value={settings.googleApiKey} onChange={(v) => update({ googleApiKey: v })} />
        <MaskedInput label="Mistral" value={settings.mistralApiKey} onChange={(v) => update({ mistralApiKey: v })} />
        <MaskedInput label="OpenRouter (300+ hosted models)" value={settings.openrouterApiKey} onChange={(v) => update({ openrouterApiKey: v })} />
        <MaskedInput label="HuggingFace (Inference)" value={settings.huggingfaceApiKey} onChange={(v) => update({ huggingfaceApiKey: v })} />
        <MaskedInput label="Serper (web search)" value={settings.serperApiKey} onChange={(v) => update({ serperApiKey: v })} />
      </div>

      <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs text-[var(--color-text-secondary)] leading-5">
        Keys are forwarded to the local Next.js API route on send — never transmitted to third parties beyond the selected provider.
        In Tauri desktop mode the route runs entirely on your machine.
      </div>
    </div>
  )
}

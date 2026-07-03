'use client'

import { useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

interface TopFeature {
  feature_id: number
  activation: number
}

interface ExploreResult {
  top_features: TopFeature[]
  hook: string
  prompt_tokens: number
}

interface Props {
  onSelectFeature?: (featureId: number, activation: number) => void
}

export function FeatureExplorer({ onSelectFeature }: Props) {
  const [prompt, setPrompt] = useState('')
  const [topK, setTopK] = useState(20)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ExploreResult | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)

  async function handleExplore() {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(amUrl(`/api/sae/explore?${new URLSearchParams({ prompt: prompt.trim(), top_k: String(topK) })}`))
      const json = await res.json() as ExploreResult & { error?: string }
      if (json.error) { setError(json.error); return }
      setResult(json)
    } catch {
      setError('Explore request failed')
    } finally {
      setLoading(false)
    }
  }

  function handleSelect(f: TopFeature) {
    setSelected(f.feature_id)
    onSelectFeature?.(f.feature_id, f.activation)
  }

  const maxAct = result ? Math.max(...result.top_features.map((f) => f.activation), 0.001) : 1

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Feature explorer</div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder="Enter a prompt to find top activating features…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleExplore() }}
        />
        <select
          value={topK}
          onChange={(e) => setTopK(parseInt(e.target.value))}
          className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
        >
          {[10, 20, 50].map((k) => <option key={k} value={k}>top {k}</option>)}
        </select>
        <button
          onClick={() => void handleExplore()}
          disabled={!prompt.trim() || loading}
          className="rounded-xl bg-[#7c3aed] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#6d28d9] disabled:opacity-50"
        >
          {loading ? '…' : 'Explore'}
        </button>
      </div>

      {error && <p className="text-[11px] text-[#dc2626]">{error} — is sae_patch.py running on port 8138?</p>}

      {result && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">hook: {result.hook} · {result.prompt_tokens} tokens</span>
            {selected !== null && <span className="text-[10px] text-[#7c3aed]">feature {selected} selected</span>}
          </div>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border-tertiary)]">
            {result.top_features.map((f, i) => (
              <button
                key={f.feature_id}
                onClick={() => handleSelect(f)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-[var(--color-background-secondary)] ${
                  selected === f.feature_id ? 'bg-[rgba(124,58,237,0.08)]' : i % 2 === 0 ? '' : ''
                }`}
              >
                <span className="w-4 shrink-0 text-[10px] font-mono text-[var(--color-text-tertiary)]">{i + 1}</span>
                <span className="w-14 shrink-0 font-mono text-[11px] text-[var(--color-text-primary)]">{f.feature_id}</span>
                <div className="flex flex-1 items-center gap-1.5">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                    <div
                      className="h-full rounded-full bg-[#7c3aed]"
                      style={{ width: `${(f.activation / maxAct) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-[10px] text-[var(--color-text-tertiary)]">
                    {f.activation.toFixed(3)}
                  </span>
                </div>
                {selected === f.feature_id && (
                  <span className="shrink-0 text-[10px] font-semibold text-[#7c3aed]">selected</span>
                )}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">Click a feature to select it for steering or causal triad analysis.</p>
        </div>
      )}
    </div>
  )
}

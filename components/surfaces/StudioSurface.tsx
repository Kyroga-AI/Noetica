'use client'

import { useEffect, useState } from 'react'

/**
 * StudioSurface — the AI-ops workbench Microsoft Foundry / IBM watsonx ship and we lacked:
 *   • Prompt Workbench — template with {variables}, params, versioned runs
 *   • Model Compare    — race the same prompt across local mesh models side-by-side (latency + output)
 * Backed by /api/cap/prompt-run, /api/cap/model-compare, /api/cap/models.
 */

interface RunRecord { id: number; template: string; vars: string; output: string; model: string; latencyMs: number }

export function StudioSurface() {
  const [tab, setTab] = useState<'prompt' | 'compare'>('prompt')
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    void fetch('/api/cap/models').then((r) => r.json()).then((d: { models?: string[] }) => setModels(d.models ?? [])).catch(() => {})
  }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-primary)]">
      <header className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Studio</h1>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">Prompt engineering · model comparison · local mesh</span>
        <div className="ml-auto flex gap-1">
          {(['prompt', 'compare'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-[11px] transition ${tab === t ? 'bg-[var(--color-background-tertiary)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}>
              {t === 'prompt' ? 'Prompt Workbench' : 'Model Compare'}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-auto p-5">
        {tab === 'prompt' ? <PromptWorkbench models={models} /> : <ModelCompare models={models} />}
      </div>
    </div>
  )
}

function PromptWorkbench({ models }: { models: string[] }) {
  const [template, setTemplate] = useState('Summarize {topic} for a {audience} audience in 3 bullets.')
  const [vars, setVars] = useState('{\n  "topic": "GraphRAG",\n  "audience": "executive"\n}')
  const [model, setModel] = useState('')
  const [temp, setTemp] = useState(0.7)
  const [output, setOutput] = useState('')
  const [latency, setLatency] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<RunRecord[]>([])

  async function run() {
    setLoading(true); setOutput(''); setLatency(null)
    try {
      let variables: Record<string, unknown> = {}
      try { variables = JSON.parse(vars || '{}') } catch { /* tolerate */ }
      const res = await fetch('/api/cap/prompt-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template, variables, model: model || undefined, temperature: temp }) })
      const d = await res.json() as { output?: string; model?: string; latencyMs?: number }
      setOutput(d.output ?? ''); setLatency(d.latencyMs ?? null)
      setHistory((h) => [{ id: h.length, template, vars, output: d.output ?? '', model: d.model ?? '', latencyMs: d.latencyMs ?? 0 }, ...h].slice(0, 10))
    } catch { setOutput('(run failed — backend offline?)') } finally { setLoading(false) }
  }

  return (
    <div className="grid h-full grid-cols-2 gap-4">
      <div className="flex flex-col gap-3">
        <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Template (use {'{variable}'})</label>
        <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={4}
          className="resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 font-mono text-xs text-[var(--color-text-primary)]" />
        <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Variables (JSON)</label>
        <textarea value={vars} onChange={(e) => setVars(e.target.value)} rows={4}
          className="resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 font-mono text-xs text-[var(--color-text-primary)]" />
        <div className="flex items-center gap-2">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-primary)]">
            <option value="">default model</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className="text-[11px] text-[var(--color-text-tertiary)]">temp {temp.toFixed(1)}</label>
          <input type="range" min={0} max={1} step={0.1} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="flex-1" />
          <button onClick={() => void run()} disabled={loading} className="rounded-md bg-[var(--color-accent,#0891b2)] px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50">{loading ? 'Running…' : 'Run'}</button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Output</label>
          {latency != null && <span className="text-[10px] text-[var(--color-text-tertiary)]">{latency} ms</span>}
        </div>
        <div className="min-h-[120px] flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">{output || '—'}</div>
        {history.length > 0 && (
          <div className="text-[10px] text-[var(--color-text-tertiary)]">
            <span className="uppercase tracking-wide">Run history ({history.length})</span>
            {history.slice(0, 4).map((h) => <div key={h.id} className="truncate">· {h.model} · {h.latencyMs}ms · {h.output.slice(0, 50)}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

function ModelCompare({ models }: { models: string[] }) {
  const [prompt, setPrompt] = useState('Explain the verifier→selection loop in one paragraph.')
  const [picked, setPicked] = useState<string[]>([])
  const [results, setResults] = useState<Array<{ model: string; output: string; latencyMs: number; error: string | null }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (picked.length === 0 && models.length) setPicked(models.slice(0, 3)) }, [models, picked.length])

  async function run() {
    setLoading(true); setResults([])
    try {
      const res = await fetch('/api/cap/model-compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, models: picked }) })
      const d = await res.json() as { results?: typeof results }
      setResults(d.results ?? [])
    } catch { /* offline */ } finally { setLoading(false) }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} className="flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-primary)]" placeholder="Prompt to race across models…" />
        <button onClick={() => void run()} disabled={loading} className="rounded-md bg-[var(--color-accent,#0891b2)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50">{loading ? 'Racing…' : 'Compare'}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {models.map((m) => (
          <button key={m} onClick={() => setPicked((p) => p.includes(m) ? p.filter((x) => x !== m) : [...p, m])}
            className={`rounded-full px-2 py-0.5 text-[10px] transition ${picked.includes(m) ? 'bg-[#0891b2]/15 text-[#0891b2]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'}`}>{m}</button>
        ))}
      </div>
      <div className="grid flex-1 gap-3 overflow-auto" style={{ gridTemplateColumns: `repeat(${Math.max(1, results.length || picked.length)}, minmax(0, 1fr))` }}>
        {(results.length ? results : picked.map((m) => ({ model: m, output: '', latencyMs: 0, error: null }))).map((r) => (
          <div key={r.model} className="flex flex-col rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-2.5 py-1.5">
              <span className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{r.model}</span>
              {r.latencyMs > 0 && <span className="text-[10px] text-[var(--color-text-tertiary)]">{r.latencyMs}ms</span>}
            </div>
            <div className="flex-1 overflow-auto whitespace-pre-wrap p-2.5 text-[11px] text-[var(--color-text-secondary)]">{r.error ? <span className="text-[#ef4444]">{r.error}</span> : (r.output || (loading ? '…' : '—'))}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

/**
 * StudioSurface — Prompt & Compare: one workbench (template + auto-parsed variables +
 * multi-model selection + Creativity + optional race), not two separate Prompt/Compare
 * tabs. "Build" runs the template against a single model; toggling "Race models" and
 * selecting more than one turns it into a side-by-side race — same template, same run.
 * Backed by /api/cap/prompt-run, /api/cap/model-compare, /api/cap/models.
 */

interface RunRecord { id: number; template: string; model: string; output: string; latencyMs: number; race: boolean }
interface RaceResult { model: string; output: string; latencyMs: number; error: string | null }

// Auto-parse {variable} placeholders out of the template, in first-seen order.
function parseVariables(template: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]) }
  }
  return out
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`)
}

export function StudioSurface() {
  const [models, setModels] = useState<string[]>([])
  const [offline, setOffline] = useState(false)

  const [template, setTemplate] = useState('Summarize {topic} for a {audience} audience in 3 bullets.')
  const [values, setValues] = useState<Record<string, string>>({ topic: 'GraphRAG', audience: 'executive' })
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [creativity, setCreativity] = useState(0.7)
  const [raceMode, setRaceMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [output, setOutput] = useState('')
  const [latency, setLatency] = useState<number | null>(null)
  const [raceResults, setRaceResults] = useState<RaceResult[]>([])
  const [history, setHistory] = useState<RunRecord[]>([])

  const variableNames = useMemo(() => parseVariables(template), [template])

  useEffect(() => {
    void fetch(amUrl('/api/cap/models'))
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { models?: string[] }) => { setModels(d.models ?? []); setOffline(false) })
      .catch(() => setOffline(true))   // surface the offline state instead of a silently empty model list
  }, [])

  useEffect(() => { if (selectedModels.length === 0 && models.length) setSelectedModels([models[0]]) }, [models, selectedModels.length])

  function toggleModel(m: string) {
    setSelectedModels((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m])
  }

  async function build() {
    setLoading(true); setOutput(''); setLatency(null); setRaceResults([])
    const filled = fillTemplate(template, values)
    try {
      if (raceMode && selectedModels.length > 1) {
        const res = await fetch(amUrl('/api/cap/model-compare'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: filled, models: selectedModels }) })
        const d = await res.json() as { results?: RaceResult[] }
        const results = d.results ?? []
        setRaceResults(results)
        setHistory((h) => [{ id: h.length, template, model: selectedModels.join(', '), output: results.map((r) => r.output).join(' · ').slice(0, 80), latencyMs: Math.max(0, ...results.map((r) => r.latencyMs)), race: true }, ...h].slice(0, 10))
      } else {
        const model = selectedModels[0]
        const res = await fetch(amUrl('/api/cap/prompt-run'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: filled, variables: {}, model: model || undefined, temperature: creativity }) })
        const d = await res.json() as { output?: string; model?: string; latencyMs?: number }
        setOutput(d.output ?? ''); setLatency(d.latencyMs ?? null)
        setHistory((h) => [{ id: h.length, template, model: d.model ?? model ?? 'default', output: d.output ?? '', latencyMs: d.latencyMs ?? 0, race: false }, ...h].slice(0, 10))
      }
    } catch {
      setOutput('(run failed — backend offline?)')
    } finally {
      setLoading(false)
    }
  }

  const willRace = raceMode && selectedModels.length > 1

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-primary)]">
      <header className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Studio</h1>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">Prompt engineering · model comparison · local mesh</span>
        {offline && <span className="text-[11px] font-medium text-[#dc2626]">· backend offline (no models loaded)</span>}
      </header>

      <div className="flex-1 overflow-auto p-5">
        {/* Top strip — template, auto-parsed variables, model checkboxes, creativity, race toggle, build */}
        <div className="space-y-3 border-b border-[var(--color-border-secondary)] pb-4">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Template (use {'{variable}'})</label>
            <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 font-mono text-xs text-[var(--color-text-primary)]" />
          </div>

          {variableNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {variableNames.map((name) => (
                <div key={name} className="flex items-center gap-1.5">
                  <label className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">{name}</label>
                  <input
                    value={values[name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                    className="w-32 rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-primary)]"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => (
                <label key={m} className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] transition ${selectedModels.includes(m) ? 'bg-[var(--color-accent,#0891b2)]/15 text-[var(--color-accent,#0891b2)]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'}`}>
                  <input type="checkbox" checked={selectedModels.includes(m)} onChange={() => toggleModel(m)} className="h-3 w-3" />
                  {m}
                </label>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[var(--color-text-tertiary)]">Creativity {creativity.toFixed(1)}</label>
              <input type="range" min={0} max={1} step={0.1} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} className="w-24" />
            </div>

            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={raceMode} onChange={(e) => setRaceMode(e.target.checked)} className="h-3 w-3" />
              Race models
            </label>

            <button
              onClick={() => void build()}
              disabled={loading || selectedModels.length === 0}
              className="ml-auto rounded-md bg-[var(--color-accent,#0891b2)] px-4 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Building…' : willRace ? 'Build & Race' : 'Build'}
            </button>
          </div>
        </div>

        {/* Results — single output, or a race grid when racing */}
        <div className="mt-4 flex min-h-0 flex-col gap-3">
          {willRace ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, raceResults.length || selectedModels.length)}, minmax(0, 1fr))` }}>
              {(raceResults.length ? raceResults : selectedModels.map((m) => ({ model: m, output: '', latencyMs: 0, error: null }))).map((r) => (
                <div key={r.model} className="flex flex-col rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
                  <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-2.5 py-1.5">
                    <span className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{r.model}</span>
                    {r.latencyMs > 0 && <span className="rounded bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">{r.latencyMs}ms</span>}
                  </div>
                  <div className="min-h-[100px] flex-1 overflow-auto whitespace-pre-wrap p-2.5 text-[11px] text-[var(--color-text-secondary)]">
                    {r.error ? <span className="text-[#ef4444]">{r.error}</span> : (r.output || (loading ? '…' : '—'))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Output</label>
                {latency != null && <span className="rounded bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">{latency} ms</span>}
              </div>
              <div className="mt-1 min-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">{output || '—'}</div>
            </div>
          )}

          {/* Run history — horizontal timeline strip */}
          {history.length > 0 && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Run history ({history.length})</label>
              <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                {history.map((h) => (
                  <div key={h.id} className="flex shrink-0 flex-col gap-0.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5" style={{ minWidth: 160, maxWidth: 220 }}>
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-text-primary)]">
                      {h.race && <span className="text-[var(--color-accent,#0891b2)]">⚡</span>}
                      <span className="truncate">{h.model}</span>
                      <span className="ml-auto shrink-0 rounded bg-[var(--color-background-tertiary)] px-1 py-px text-[9px] text-[var(--color-text-tertiary)]">{h.latencyMs}ms</span>
                    </div>
                    <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">{h.output || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

/**
 * StudioSurface — Prompt & Compare: one workbench (template + auto-parsed variables +
 * multi-model selection + Creativity + optional race), not two separate Prompt/Compare
 * tabs. "Build" runs the template against a single model; toggling "Race models" and
 * selecting more than one turns it into a side-by-side race — same template, same run.
 * Backed by /api/cap/prompt-run, /api/cap/model-compare, /api/cap/models.
 *
 * Additional tabs: RAG Inspector, Capabilities, Alignment Checker (stub UIs).
 */

interface RunRecord { id: number; template: string; model: string; output: string; latencyMs: number; race: boolean }
interface RaceResult { model: string; output: string; latencyMs: number; error: string | null }

type StudioTab = 'prompt' | 'rag' | 'capabilities' | 'alignment'

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

/* ─── Tab content: RAG Inspector ─────────────────────────────────────── */
function RAGInspectorTab() {
  const [query, setQuery] = useState('')
  const [inspected, setInspected] = useState(false)

  const demoSemantic = [
    { source: 'knowledge-base/architecture.md', score: 0.94, preview: 'The system uses a microkernel architecture with plugin-based extensions...' },
    { source: 'docs/onboarding.md', score: 0.87, preview: 'New contributors should start by reading the architecture overview...' },
    { source: 'wiki/design-decisions.md', score: 0.72, preview: 'We chose event sourcing to maintain a full audit trail of state changes...' },
  ]
  const demoLexical = [
    { source: 'README.md', score: 0.91, preview: 'GraphRAG combines knowledge-graph traversal with retrieval-augmented generation...' },
    { source: 'config/rag-pipeline.yaml', score: 0.68, preview: 'chunk_size: 512, overlap: 64, embedding_model: text-embedding-3-small...' },
  ]

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-xs text-[var(--color-text-tertiary)]">
        Inspect how your RAG pipeline retrieves and ranks chunks for a given query. See semantic vs. lexical results side-by-side.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a retrieval query..."
          className="flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
        />
        <button
          onClick={() => setInspected(true)}
          disabled={!query.trim()}
          className="rounded-lg bg-[var(--color-accent,#0891b2)] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Inspect
        </button>
      </div>

      {!inspected ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <span className="text-sm text-[var(--color-text-tertiary)]" style={{ opacity: 0.45 }}>
            Enter a query and hit Inspect to see retrieval results
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Semantic results */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Semantic</span>
            </div>
            {demoSemantic.map((chunk, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{chunk.source}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                      <div className="h-full rounded-full bg-[#8b5cf6]" style={{ width: `${chunk.score * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{(chunk.score * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">{chunk.preview}</p>
              </div>
            ))}
          </div>
          {/* Lexical results */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Lexical</span>
            </div>
            {demoLexical.map((chunk, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{chunk.source}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                      <div className="h-full rounded-full bg-[#f59e0b]" style={{ width: `${chunk.score * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{(chunk.score * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">{chunk.preview}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Tab content: Capabilities ──────────────────────────────────────── */
interface Capability { name: string; group: string; description: string; endpoint: string; payload: string }
const demoCapabilities: Capability[] = [
  { name: 'prompt-run', group: 'Core', description: 'Run a prompt template against a model with variable substitution and temperature control.', endpoint: 'POST /api/cap/prompt-run', payload: '{\n  "template": "Summarize {topic}",\n  "variables": { "topic": "AI safety" },\n  "model": "gpt-4o",\n  "temperature": 0.7\n}' },
  { name: 'model-compare', group: 'Core', description: 'Race the same prompt across multiple models and compare outputs side-by-side.', endpoint: 'POST /api/cap/model-compare', payload: '{\n  "prompt": "Explain quantum computing",\n  "models": ["gpt-4o", "claude-3"]\n}' },
  { name: 'models', group: 'Core', description: 'List all available models on the local mesh.', endpoint: 'GET /api/cap/models', payload: '{}' },
  { name: 'embed-text', group: 'RAG', description: 'Generate embeddings for a text chunk using the configured embedding model.', endpoint: 'POST /api/cap/embed', payload: '{\n  "text": "Sample text to embed",\n  "model": "text-embedding-3-small"\n}' },
  { name: 'chunk-retrieve', group: 'RAG', description: 'Retrieve top-k chunks from the vector store for a given query.', endpoint: 'POST /api/cap/retrieve', payload: '{\n  "query": "architecture overview",\n  "top_k": 5\n}' },
  { name: 'alignment-check', group: 'Safety', description: 'Check a generated response against source documents for factual alignment.', endpoint: 'POST /api/cap/alignment', payload: '{\n  "response": "The system uses microservices.",\n  "sources": ["doc1.md", "doc2.md"]\n}' },
]

function CapabilitiesTab() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Capability | null>(null)
  const [payload, setPayload] = useState('')
  const [result, setResult] = useState('')

  const groups = useMemo(() => {
    const filtered = demoCapabilities.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    const map = new Map<string, Capability[]>()
    for (const c of filtered) {
      if (!map.has(c.group)) map.set(c.group, [])
      map.get(c.group)!.push(c)
    }
    return map
  }, [search])

  function selectCap(c: Capability) {
    setSelected(c)
    setPayload(c.payload)
    setResult('')
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left rail */}
      <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
        <div className="p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search capabilities..."
            className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
          />
        </div>
        <div className="flex-1 overflow-auto px-2 pb-3">
          {[...groups.entries()].map(([group, caps]) => (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{group}</div>
              {caps.map((c) => (
                <button
                  key={c.name}
                  onClick={() => selectCap(c)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-[11px] transition ${selected?.name === c.name ? 'bg-[var(--color-accent,#0891b2)]/15 font-medium text-[var(--color-accent,#0891b2)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 flex-col overflow-auto p-5">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-[var(--color-text-tertiary)]" style={{ opacity: 0.45 }}>Select a capability from the list.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{selected.name}</h3>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selected.description}</p>
              <span className="mt-2 inline-block rounded-full bg-[var(--color-background-tertiary)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                {selected.endpoint}
              </span>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Payload</label>
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={6}
                className="mt-1 w-full resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 font-mono text-xs text-[var(--color-text-primary)]"
              />
            </div>
            <button
              onClick={() => setResult('{\n  "status": "ok",\n  "result": "Demo response — connect to backend for live data."\n}')}
              className="w-fit rounded-lg bg-[var(--color-accent,#0891b2)] px-4 py-2 text-xs font-medium text-white"
            >
              Run
            </button>
            {result && (
              <div>
                <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Result</label>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 font-mono text-xs text-[var(--color-text-secondary)]">
                  {result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Tab content: Alignment Checker ─────────────────────────────────── */
interface AlignmentSentence { text: string; verdict: 'corroborated' | 'conflicting' | 'novel' }
const sampleInput = 'The system uses a microkernel architecture. It supports plugin-based extensions via a REST API. All data is encrypted at rest using AES-256. The deployment target is Kubernetes on AWS.'
const sampleResults: AlignmentSentence[] = [
  { text: 'The system uses a microkernel architecture.', verdict: 'corroborated' },
  { text: 'It supports plugin-based extensions via a REST API.', verdict: 'corroborated' },
  { text: 'All data is encrypted at rest using AES-256.', verdict: 'conflicting' },
  { text: 'The deployment target is Kubernetes on AWS.', verdict: 'novel' },
]

const verdictColors: Record<string, string> = {
  corroborated: '#22c55e',
  conflicting: '#ef4444',
  novel: '#8b5cf6',
}

function AlignmentCheckerTab() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<AlignmentSentence[] | null>(null)

  function check() {
    setResults(sampleResults)
  }

  function trySample() {
    setInput(sampleInput)
    setResults(null)
  }

  const score = results ? Math.round((results.filter((r) => r.verdict === 'corroborated').length / results.length) * 100) : null
  const counts = results ? {
    corroborated: results.filter((r) => r.verdict === 'corroborated').length,
    conflicting: results.filter((r) => r.verdict === 'conflicting').length,
    novel: results.filter((r) => r.verdict === 'novel').length,
  } : null

  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      <p className="text-xs text-[var(--color-text-tertiary)]">
        Check generated text against source documents for factual alignment. Each sentence is classified as corroborated, conflicting, or novel.
      </p>
      <div>
        <textarea
          value={input}
          onChange={(e) => { setInput(e.target.value); setResults(null) }}
          placeholder="Paste generated text to check..."
          rows={5}
          className="w-full resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={check}
          disabled={!input.trim()}
          className="rounded-lg bg-[var(--color-accent,#0891b2)] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Check alignment
        </button>
        <button
          onClick={trySample}
          className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)]"
        >
          Try a sample
        </button>
      </div>

      {results && score !== null && counts && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-[var(--color-text-primary)]">{score}%</span>
              <span className="text-[11px] text-[var(--color-text-tertiary)]">alignment score</span>
            </div>
            <span className="text-[11px] font-medium" style={{ color: score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444' }}>
              {score >= 75 ? 'Well aligned' : score >= 50 ? 'Partially aligned' : 'Poorly aligned'}
            </span>
            <div className="ml-auto flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />{counts.corroborated} corroborated</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" />{counts.conflicting} conflicting</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#8b5cf6]" />{counts.novel} novel</span>
            </div>
          </div>

          {/* Per-sentence cards */}
          <div className="flex flex-col gap-2">
            {results.map((r, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3"
                style={{ borderLeftWidth: 3, borderLeftColor: verdictColors[r.verdict] }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[var(--color-text-primary)]">{r.text}</p>
                  <span
                    className="ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ color: verdictColors[r.verdict], backgroundColor: `${verdictColors[r.verdict]}15` }}
                  >
                    {r.verdict}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Main surface ───────────────────────────────────────────────────── */
export function StudioSurface() {
  const [studioTab, setStudioTab] = useState<StudioTab>('prompt')
  const [models, setModels] = useState<string[]>([])
  const [offline, setOffline] = useState(false)
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)

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
      .catch(() => setOffline(true))
  }, [])

  useEffect(() => { if (selectedModels.length === 0 && models.length) setSelectedModels([models[0]]) }, [models, selectedModels.length])

  function toggleModel(m: string) {
    setSelectedModels((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m])
  }

  function restoreRun(h: RunRecord) {
    setTemplate(h.template)
    setOutput(h.output)
    setLatency(h.latencyMs)
    setRaceResults([])
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
  const hasOutput = output || raceResults.length > 0

  const tabs: { key: StudioTab; label: string }[] = [
    { key: 'prompt', label: 'Prompt & Compare' },
    { key: 'rag', label: 'RAG Inspector' },
    { key: 'capabilities', label: 'Capabilities' },
    { key: 'alignment', label: 'Alignment Checker' },
  ]

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-primary)]">
      {/* ── Fixed top bar (50px) ────────────────────────────────────── */}
      <header className="flex h-[50px] shrink-0 items-center gap-4 border-b border-[var(--color-border-secondary)] px-5">
        <h1 className="text-[14px] font-extrabold text-[var(--color-text-primary)]">Studio</h1>
        {offline && <span className="text-[11px] font-medium text-[#dc2626]">backend offline (no models loaded)</span>}

        {/* Pill tab strip */}
        <div className="ml-4 flex items-center rounded-[10px] bg-[var(--color-background-secondary)] p-[3px]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStudioTab(t.key)}
              className={`rounded-[8px] px-3 py-1.5 text-[11px] transition-all ${studioTab === t.key ? 'bg-[var(--color-background-primary)] font-bold text-[var(--color-text-primary)] shadow-sm' : 'font-semibold text-[var(--color-text-secondary)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* ── Tab content ─────────────────────────────────────────────── */}
      {studioTab === 'prompt' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Constructor strip — 3 columns */}
          <div className="flex shrink-0 gap-4 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
            {/* Column 1: Prompt template */}
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Prompt template</label>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-2.5 font-mono text-xs text-[var(--color-text-primary)]"
              />
              <span className="text-[10px] text-[var(--color-text-tertiary)]">{'Use {variable} placeholders — fill them in below'}</span>
            </div>

            {/* Column 2: Auto-parsed variable fields */}
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Variables</label>
              {variableNames.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {variableNames.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <label className="w-20 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{name}</label>
                      <input
                        value={values[name] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                        className="flex-1 rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)]"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <span className="text-[11px] text-[var(--color-text-tertiary)]" style={{ opacity: 0.6 }}>{'No {variables} in template.'}</span>
                </div>
              )}
            </div>

            {/* Column 3: Model selector + Creativity + Race + Build */}
            <div className="flex w-[200px] shrink-0 flex-col gap-2.5">
              {/* Model dropdown trigger + popover */}
              <div className="relative">
                <button
                  onClick={() => setModelPopoverOpen(!modelPopoverOpen)}
                  className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)]"
                >
                  <span className="truncate">{selectedModels.length ? selectedModels.join(', ') : 'Select models'}</span>
                  <svg className="h-3 w-3 shrink-0 text-[var(--color-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {modelPopoverOpen && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-2 shadow-lg">
                    {models.length === 0 && <span className="text-[10px] text-[var(--color-text-tertiary)]">No models available</span>}
                    {models.map((m) => (
                      <label key={m} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
                        <input type="checkbox" checked={selectedModels.includes(m)} onChange={() => toggleModel(m)} className="h-3 w-3" />
                        <span className="truncate">{m}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Creativity slider */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Creativity</span>
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">{creativity.toFixed(1)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.1} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} className="w-full" />
                <div className="flex justify-between">
                  <span className="text-[9px] text-[var(--color-text-tertiary)]">Focused</span>
                  <span className="text-[9px] text-[var(--color-text-tertiary)]">Creative</span>
                </div>
              </div>

              {/* Race toggle pill */}
              <label className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={raceMode} onChange={(e) => setRaceMode(e.target.checked)} className="h-3 w-3" />
                Race models
              </label>

              {/* Build button — full-width, accent bg */}
              <button
                onClick={() => void build()}
                disabled={loading || selectedModels.length === 0}
                className="w-full rounded-lg bg-[var(--color-accent,#0891b2)] p-[12px] text-[14px] font-medium text-white disabled:opacity-50"
              >
                {loading ? 'Building…' : willRace ? 'Build & Race' : 'Build'}
              </button>
            </div>
          </div>

          {/* ── Results area ──────────────────────────────────────────── */}
          <div className="flex flex-1 flex-col overflow-auto p-5">
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {willRace ? (
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, raceResults.length || selectedModels.length)}, minmax(0, 1fr))` }}>
                  {(raceResults.length ? raceResults : selectedModels.map((m) => ({ model: m, output: '', latencyMs: 0, error: null }))).map((r) => (
                    <div key={r.model} className="flex flex-col rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
                      <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-2.5 py-1.5">
                        <span className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{r.model}</span>
                        {r.latencyMs > 0 && (
                          <span className="rounded bg-[#22c55e]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#16a34a]">{r.latencyMs}ms</span>
                        )}
                      </div>
                      <div className="min-h-[100px] flex-1 overflow-auto whitespace-pre-wrap p-2.5 text-[11px] text-[var(--color-text-secondary)]">
                        {r.error ? <span className="text-[#ef4444]">{r.error}</span> : (r.output || (loading ? '…' : '—'))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 flex-col">
                  {!hasOutput && !loading ? (
                    /* Empty state */
                    <div className="flex flex-1 items-center justify-center">
                      <span className="text-sm text-[var(--color-text-tertiary)]" style={{ opacity: 0.45 }}>Fill in the variables and hit Build</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Result</label>
                        {latency != null && (
                          <span className="rounded bg-[#22c55e]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#16a34a]">{latency} ms</span>
                        )}
                      </div>
                      <div className="mt-1 min-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
                        {output || '—'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Run history — pinned to bottom ────────────────────────── */}
          {history.length > 0 && (
            <div className="shrink-0 border-t border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-5 py-3">
              <label className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Run history — click to restore</label>
              <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => restoreRun(h)}
                    className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-left transition hover:border-[var(--color-accent,#0891b2)]"
                    style={{ minWidth: 140, maxWidth: 240 }}
                  >
                    {h.race && <span className="text-[var(--color-accent,#0891b2)]">&#x26A1;</span>}
                    <span className="truncate text-[10px] font-medium text-[var(--color-text-primary)]">{h.model}</span>
                    <span className="ml-auto shrink-0 rounded bg-[var(--color-background-tertiary)] px-1 py-px text-[9px] text-[var(--color-text-tertiary)]">{h.latencyMs}ms</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {studioTab === 'rag' && <RAGInspectorTab />}
      {studioTab === 'capabilities' && <CapabilitiesTab />}
      {studioTab === 'alignment' && <AlignmentCheckerTab />}
    </div>
  )
}

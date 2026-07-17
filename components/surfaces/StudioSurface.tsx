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
 * Additional tabs: RAG Inspector, Capabilities, Alignment Checker.
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
  const [running, setRunning] = useState(false)
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

  function runInspect() {
    setRunning(true)
    setTimeout(() => { setRunning(false); setInspected(true) }, 400)
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 22, gap: 16, overflowY: 'auto' }}>
      <div style={{ maxWidth: 700, width: '100%' }}>
        <div style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--ink2)', marginBottom: 14 }}>
          Paste a query to see exactly which chunks were retrieved — and whether they came from semantic (embedding) or lexical (keyword) search. Use this when an answer seems off and you want to know why.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. how does the critic work?"
            style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: '14px', fontFamily: "'Manrope', sans-serif", color: 'var(--ink)', background: 'var(--paper)' }}
          />
          <div
            onClick={() => { if (query.trim()) runInspect() }}
            style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: query.trim() ? 1 : 0.5 }}
          >
            {running ? 'Inspecting...' : 'Inspect'}
          </div>
        </div>
      </div>

      {running && (
        <div style={{ color: 'var(--ink3)', fontSize: 13 }}>Inspecting...</div>
      )}

      {inspected && !running && (
        <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
          {/* Semantic column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--violet)' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Semantic · dense / nomic-embed</span>
            </div>
            {demoSemantic.map((chunk, i) => (
              <div key={i} style={{ background: 'var(--paper-sunk)', borderRadius: 12, padding: 14, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chunk.source}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--violet-fg)', flexShrink: 0 }}>{chunk.score.toFixed(2)}</span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: 'var(--paper-sunk-2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${chunk.score * 100}%`, background: 'var(--violet)', borderRadius: 999 }} />
                </div>
                <div style={{ fontSize: '12.5px', lineHeight: 1.6, color: 'var(--ink)', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{chunk.preview}</div>
              </div>
            ))}
          </div>
          {/* Lexical column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pending)' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Lexical · BM25 keyword</span>
            </div>
            {demoLexical.map((chunk, i) => (
              <div key={i} style={{ background: 'var(--paper-sunk)', borderRadius: 12, padding: 14, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chunk.source}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--pending-fg)', flexShrink: 0 }}>{chunk.score.toFixed(2)}</span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: 'var(--paper-sunk-2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${chunk.score * 100}%`, background: 'var(--pending)', borderRadius: 999 }} />
                </div>
                <div style={{ fontSize: '12.5px', lineHeight: 1.6, color: 'var(--ink)', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{chunk.preview}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!inspected && !running && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.45 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>Enter a query and hit Inspect to see retrieval results</div>
        </div>
      )}
    </div>
  )
}

/* ─── Tab content: Capabilities ──────────────────────────────────────── */
interface Capability { name: string; group: string; description: string; endpoint: string; payload: string }
const demoCapabilities: Capability[] = [
  { name: 'prompt-run', group: 'Core', description: 'Run a prompt template against a model with variable substitution and temperature control.', endpoint: '/api/cap/prompt-run', payload: '{\n  "template": "Summarize {topic}",\n  "variables": { "topic": "AI safety" },\n  "model": "gpt-4o",\n  "temperature": 0.7\n}' },
  { name: 'model-compare', group: 'Core', description: 'Race the same prompt across multiple models and compare outputs side-by-side.', endpoint: '/api/cap/model-compare', payload: '{\n  "prompt": "Explain quantum computing",\n  "models": ["gpt-4o", "claude-3"]\n}' },
  { name: 'models', group: 'Core', description: 'List all available models on the local mesh.', endpoint: '/api/cap/models', payload: '{}' },
  { name: 'embed-text', group: 'RAG', description: 'Generate embeddings for a text chunk using the configured embedding model.', endpoint: '/api/cap/embed', payload: '{\n  "text": "Sample text to embed",\n  "model": "text-embedding-3-small"\n}' },
  { name: 'chunk-retrieve', group: 'RAG', description: 'Retrieve top-k chunks from the vector store for a given query.', endpoint: '/api/cap/retrieve', payload: '{\n  "query": "architecture overview",\n  "top_k": 5\n}' },
  { name: 'alignment-check', group: 'Safety', description: 'Check a generated response against source documents for factual alignment.', endpoint: '/api/cap/alignment', payload: '{\n  "response": "The system uses microservices.",\n  "sources": ["doc1.md", "doc2.md"]\n}' },
]

function CapabilitiesTab() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Capability | null>(null)
  const [payload, setPayload] = useState('')
  const [result, setResult] = useState('')
  const [resultStatus, setResultStatus] = useState('')

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
    setResultStatus('')
  }

  function runCap() {
    setResult('{\n  "status": "ok",\n  "result": "Demo response — connect to backend for live data."\n}')
    setResultStatus('200 OK · 142ms')
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      {/* Left rail */}
      <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--paper-sunk)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search capabilities..."
            style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontSize: '12.5px', fontFamily: "'Manrope', sans-serif", color: 'var(--ink)', background: 'var(--paper)' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {[...groups.entries()].map(([group, caps], gi) => (
            <div key={group} style={{ marginBottom: 2 }}>
              <div style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '1px', color: 'var(--ink3)', textTransform: 'uppercase', padding: '10px 10px 4px', borderTop: gi > 0 ? '1px solid var(--line)' : undefined, marginTop: gi > 0 ? 4 : undefined }}>
                {group}
              </div>
              {caps.map((c) => (
                <div
                  key={c.name}
                  onClick={() => selectCap(c)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    fontSize: '12.5px',
                    marginBottom: 1,
                    ...(selected?.name === c.name
                      ? { background: 'var(--accent-soft)', fontWeight: 700, color: 'var(--accent)' }
                      : { fontWeight: 500, color: 'var(--ink)' })
                  }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right: capability detail */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selected ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>{selected.name}</div>
              <div style={{ fontSize: '13.5px', lineHeight: 1.65, color: 'var(--ink2)', marginBottom: 10 }}>{selected.description}</div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', background: 'var(--paper-sunk)', padding: '4px 10px', borderRadius: 6, color: 'var(--ink2)' }}>POST {selected.endpoint}</span>
            </div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase', marginBottom: 8 }}>Payload — edit and run</div>
              <textarea
                rows={8}
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', fontSize: '12.5px', fontFamily: "var(--font-mono)", color: 'var(--ink)', background: 'var(--paper-sunk)', resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div
                onClick={runCap}
                style={{ padding: '10px 22px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer' }}
              >
                Run
              </div>
              <span style={{ fontSize: '11.5px', color: 'var(--ink3)' }}>or Cmd + Enter</span>
            </div>
            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Result</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'var(--verified-soft)', color: 'var(--verified-fg)', padding: '3px 9px', borderRadius: 999 }}>{resultStatus}</span>
                </div>
                <div style={{ background: 'var(--paper-sunk)', borderRadius: 12, padding: 16, fontSize: '12.5px', fontFamily: 'var(--font-mono)', color: 'var(--ink)', lineHeight: 1.7, whiteSpace: 'pre-wrap', border: '1px solid var(--line)' }}>{result}</div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>Select a capability from the list</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Tab content: Alignment Checker ─────────────────────────────────── */
interface AlignmentSentence {
  text: string
  verdict: 'corroborated' | 'conflicting' | 'novel'
  sourceText?: string
  similarity?: string
}

const sampleInput = 'The system uses a microkernel architecture. It supports plugin-based extensions via a REST API. All data is encrypted at rest using AES-256. The deployment target is Kubernetes on AWS.'
const sampleResults: AlignmentSentence[] = [
  { text: 'The system uses a microkernel architecture.', verdict: 'corroborated', sourceText: 'The system uses a microkernel architecture with plugin-based extensions.', similarity: '0.97 cosine' },
  { text: 'It supports plugin-based extensions via a REST API.', verdict: 'corroborated', sourceText: 'Extensions are loaded via a plugin registry exposed through REST endpoints.', similarity: '0.89 cosine' },
  { text: 'All data is encrypted at rest using AES-256.', verdict: 'conflicting', sourceText: 'Data at rest uses ChaCha20-Poly1305, not AES.', similarity: '0.82 cosine' },
  { text: 'The deployment target is Kubernetes on AWS.', verdict: 'novel' },
]

const verdictConfig: Record<string, { color: string; bg: string; border: string; symbol: string }> = {
  corroborated: { color: 'var(--verified-fg)', bg: 'var(--verified-soft)', border: 'var(--verified)', symbol: '✓' },
  conflicting: { color: 'var(--danger-fg)', bg: 'var(--danger-fg)', border: 'var(--danger)', symbol: '✕' },
  novel: { color: 'var(--violet-fg)', bg: 'var(--violet-soft)', border: 'var(--violet)', symbol: '◎' },
}

function AlignmentCheckerTab() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<AlignmentSentence[] | null>(null)
  const [running, setRunning] = useState(false)

  function check() {
    setRunning(true)
    setTimeout(() => { setRunning(false); setResults(sampleResults) }, 400)
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
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 22, gap: 16, overflowY: 'auto' }}>
      <div style={{ maxWidth: 760, width: '100%' }}>
        <div style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--ink2)', marginBottom: 12 }}>
          Paste any text — article, claim, meeting note — and Noetica checks each sentence against your knowledge graph. Sentences that agree with your ingested documents are <b style={{ color: 'var(--verified-fg)' }}>corroborated</b>, those that contradict are <b style={{ color: 'var(--danger-fg)' }}>conflicting</b>, and genuinely new information is <b style={{ color: 'var(--violet)' }}>novel</b>.
        </div>
        <textarea
          rows={5}
          value={input}
          onChange={(e) => { setInput(e.target.value); setResults(null) }}
          placeholder="Paste a news article, claim, or any block of text..."
          style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', fontSize: '13.5px', fontFamily: "'Manrope', sans-serif", color: 'var(--ink)', background: 'var(--paper)', resize: 'vertical', lineHeight: 1.7, marginBottom: 10 }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div
            onClick={() => { if (input.trim()) check() }}
            style={{ padding: '10px 22px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', opacity: input.trim() ? 1 : 0.5 }}
          >
            {running ? 'Checking...' : 'Check alignment'}
          </div>
          <div
            onClick={trySample}
            style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--line)', fontSize: '13px', fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer' }}
          >
            Try a sample
          </div>
        </div>
      </div>

      {results && score !== null && counts && (
        <div style={{ maxWidth: 760, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--paper-sunk)', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: score >= 75 ? 'var(--verified-fg)' : score >= 50 ? 'var(--pending-fg)' : 'var(--danger-fg)' }}>{score}%</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
                {score >= 75 ? 'Well aligned with your knowledge graph' : score >= 50 ? 'Partially aligned' : 'Poorly aligned'}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: '12px', color: 'var(--verified-fg)' }}>{'✓'} {counts.corroborated} corroborated</span>
                <span style={{ fontSize: '12px', color: 'var(--danger-fg)' }}>{'✕'} {counts.conflicting} conflicting</span>
                <span style={{ fontSize: '12px', color: 'var(--violet-fg)' }}>{'◎'} {counts.novel} novel</span>
              </div>
            </div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}>View governance posture {'→'}</span>
          </div>

          {/* Per-sentence cards */}
          {results.map((sentence, i) => {
            const vc = verdictConfig[sentence.verdict]
            return (
              <div
                key={i}
                style={{
                  background: 'var(--paper-sunk)',
                  borderRadius: 12,
                  padding: '14px 16px',
                  borderLeft: `3px solid ${vc.border}`,
                  borderTop: '1px solid var(--line)',
                  borderRight: '1px solid var(--line)',
                  borderBottom: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--ink)', flex: 1 }}>{sentence.text}</div>
                  <div style={{ padding: '3px 10px', borderRadius: 999, fontSize: '11px', fontWeight: 700, color: vc.color, background: vc.bg, whiteSpace: 'nowrap', flexShrink: 0 }}>{sentence.verdict}</div>
                </div>
                {sentence.sourceText && (
                  <div style={{ fontSize: '11.5px', color: 'var(--ink2)', lineHeight: 1.55, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
                    <span style={{ fontWeight: 700 }}>Source:</span> {sentence.sourceText}{' '}
                    {sentence.similarity && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--ink3)' }}>({sentence.similarity})</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Main surface ───────────────────────────────────────────────────── */
export function StudioSurface() {
  const [studioTab, setStudioTab] = useState<StudioTab>('prompt')
  const [models, setModels] = useState<string[]>([])
  const [offline, setOffline] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)

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

  // Classify variables: short names (<= 8 chars) go inline, long ones get stacked textareas
  const smallFields = variableNames.filter((n) => n.length <= 8)
  const largeFields = variableNames.filter((n) => n.length > 8)

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

  const selectedModelsLabel = selectedModels.length ? selectedModels.join(', ') : 'Select models'

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Studio topbar with tab strip (50px) ────────────────────── */}
      <div style={{ height: 50, flexShrink: 0, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 14 }}>
        <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>Studio</span>
        {offline && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--danger-fg)' }}>backend offline</span>}

        {/* Pill tab strip */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--paper-sunk-2)', borderRadius: 10, padding: 3 }}>
          {tabs.map((t) => (
            <div
              key={t.key}
              onClick={() => setStudioTab(t.key)}
              style={{
                padding: '5px 16px',
                borderRadius: 8,
                fontSize: '12.5px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                ...(studioTab === t.key
                  ? { background: 'var(--paper)', fontWeight: 700, color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                  : { fontWeight: 600, color: 'var(--ink2)' })
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Race models toggle — only on Prompt tab */}
        {studioTab === 'prompt' && (
          raceMode ? (
            <div
              onClick={() => setRaceMode(false)}
              style={{ padding: '5px 14px', borderRadius: 999, background: 'var(--accent-soft)', border: '1px solid var(--accent)', cursor: 'pointer', fontSize: '12.5px', fontWeight: 700, color: 'var(--accent)' }}
            >
              Race models: on
            </div>
          ) : (
            <div
              onClick={() => setRaceMode(true)}
              style={{ padding: '5px 14px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: 'var(--ink2)' }}
            >
              Race models
            </div>
          )
        )}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      {studioTab === 'rag' && <RAGInspectorTab />}
      {studioTab === 'capabilities' && <CapabilitiesTab />}
      {studioTab === 'alignment' && <AlignmentCheckerTab />}

      {studioTab === 'prompt' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* TOP: constructor (3-column grid) */}
          <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--paper-sunk)', padding: '14px 22px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            {/* col 1: template */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase', marginBottom: 7 }}>Prompt template</div>
              <textarea
                rows={2}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--ink)', background: 'var(--paper)', resize: 'vertical', lineHeight: 1.5 }}
              />
              <div style={{ marginTop: 5, fontSize: '10.5px', color: 'var(--ink3)' }}>
                Use <span style={{ fontFamily: 'var(--font-mono)' }}>{'{variable}'}</span> placeholders — fill them in below
              </div>
            </div>

            {/* col 2: variables */}
            <div style={{ flex: 1.4, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase', marginBottom: 1 }}>Variables</div>
              {variableNames.length > 0 ? (
                <>
                  {/* Small vars inline row */}
                  {smallFields.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {smallFields.map((name) => (
                        <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 80 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, color: 'var(--ink2)' }}>{name}</span>
                          <input
                            value={values[name] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                            placeholder={name}
                            style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 8px', fontSize: '12.5px', fontFamily: "'Manrope', sans-serif", color: 'var(--ink)', background: 'var(--paper)' }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Large vars stacked */}
                  {largeFields.map((name) => (
                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, color: 'var(--ink2)' }}>{name}</span>
                      <textarea
                        rows={3}
                        value={values[name] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                        placeholder={name}
                        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '7px 10px', fontSize: '13px', fontFamily: "'Manrope', sans-serif", color: 'var(--ink)', background: 'var(--paper)', resize: 'vertical', lineHeight: 1.6 }}
                      />
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--ink3)' }}>
                  No <span style={{ fontFamily: 'var(--font-mono)' }}>{'{variables}'}</span> in template.
                </div>
              )}
            </div>

            {/* col 3: controls */}
            <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Model dropdown */}
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase', marginBottom: 7 }}>Models</div>
                <div
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', background: 'var(--paper)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedModelsLabel}</span>
                  <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid var(--ink2)' }} />
                </div>
                {modelDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 40, padding: 6, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {models.length === 0 && <span style={{ fontSize: '11px', color: 'var(--ink3)', padding: '7px 10px' }}>No models available</span>}
                    {models.map((m) => {
                      const isChecked = selectedModels.includes(m)
                      return (
                        <div
                          key={m}
                          onClick={() => toggleModel(m)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer' }}
                        >
                          <div style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isChecked ? 'var(--accent-soft)' : 'transparent' }}>
                            {isChecked && <div style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--accent)' }} />}
                          </div>
                          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)' }}>{m}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Creativity slider */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Creativity</div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', fontWeight: 700, color: 'var(--ink)' }}>{creativity.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={creativity}
                  onChange={(e) => setCreativity(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: '10px', color: 'var(--ink3)' }}>Focused</span>
                  <span style={{ fontSize: '10px', color: 'var(--ink3)' }}>Creative</span>
                </div>
              </div>

              {/* Race toggle */}
              {raceMode ? (
                <div
                  onClick={() => setRaceMode(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 999, background: 'var(--accent-soft)', border: '1px solid var(--accent)', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: 'var(--accent)' }}
                >
                  Race models: on
                </div>
              ) : (
                <div
                  onClick={() => setRaceMode(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--ink2)' }}
                >
                  Race models
                </div>
              )}

              {/* Build button */}
              <div
                onClick={() => { if (!loading && selectedModels.length > 0) void build() }}
                style={{ padding: 12, borderRadius: 12, background: 'var(--accent)', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: loading || selectedModels.length === 0 ? 'default' : 'pointer', textAlign: 'center', opacity: loading || selectedModels.length === 0 ? 0.5 : 1 }}
              >
                {loading ? 'Building...' : willRace ? 'Build & Race' : 'Build'}
              </div>
            </div>
          </div>

          {/* BOTTOM: results + history */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 22 }}>
              {/* Running placeholder */}
              {loading && (
                <div style={{ display: 'flex', gap: 14, height: 200 }}>
                  {(willRace ? selectedModels : ['Building']).map((label) => (
                    <div key={label} style={{ flex: 1, background: 'var(--paper-sunk)', borderRadius: 14, padding: 20, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)', fontSize: 13 }}>
                      {willRace ? `${label}...` : 'Building...'}
                    </div>
                  ))}
                </div>
              )}

              {/* Single result */}
              {!loading && output && !willRace && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Result</span>
                    {latency != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--verified-fg)', background: 'var(--verified-soft)', padding: '3px 8px', borderRadius: 999 }}>{latency}ms</span>
                    )}
                    {selectedModels[0] && <span style={{ fontSize: '11px', color: 'var(--ink3)' }}>{selectedModels[0]}</span>}
                  </div>
                  <div style={{ background: 'var(--paper-sunk)', borderRadius: 14, padding: 20, fontSize: '14px', lineHeight: 1.75, color: 'var(--ink)', border: '1px solid var(--line)', whiteSpace: 'pre-wrap' }}>{output}</div>
                </>
              )}

              {/* Race results */}
              {!loading && raceResults.length > 0 && (
                <div style={{ display: 'flex', gap: 12, minHeight: 200 }}>
                  {raceResults.map((result) => (
                    <div key={result.model} style={{ flex: 1, minWidth: 180, background: 'var(--paper-sunk)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--ink)' }}>{result.model}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--verified-fg)', background: 'var(--verified-soft)', padding: '3px 9px', borderRadius: 999 }}>{result.latencyMs}ms</span>
                      </div>
                      <div style={{ fontSize: '13.5px', lineHeight: 1.7, color: 'var(--ink2)', flex: 1, whiteSpace: 'pre-wrap' }}>
                        {result.error ? <span style={{ color: 'var(--danger-fg)' }}>{result.error}</span> : result.output}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!loading && !hasOutput && (
                <div style={{ height: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: 0.45 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink2)' }}>Fill in the variables and hit Build</div>
                </div>
              )}
            </div>

            {/* Run history strip */}
            {history.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', padding: '12px 22px', background: 'var(--paper-sunk)', overflowX: 'auto', flexShrink: 0 }}>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8 }}>Run history — click to restore</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap' }}>
                  {history.map((run) => (
                    <div
                      key={run.id}
                      onClick={() => restoreRun(run)}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', background: 'var(--paper)', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--verified-fg)' }}>{run.latencyMs}ms</span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink2)' }}>{run.model}</span>
                      <span style={{ fontSize: '11px', color: 'var(--ink3)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.output.slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

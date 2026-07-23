'use client'

/**
 * BuildCard — the deterministic build clarifier. Asks framework/language as multiple-choice
 * (no model call), then scaffolds + installs + starts a real dev server via /api/code/scaffold
 * and shows the LIVE preview. "Build me a UI" → a running app, not a narrated tutorial.
 */
import { useState } from 'react'
import { isTauri } from '@/lib/tauri/bridge'
import type { BuildSpec } from '@/lib/types/message'
import { openExternal } from '@/lib/tauri/openExternal'

function amBase(): string { return isTauri() ? 'http://127.0.0.1:8080' : '' }

interface ScaffoldResult {
  ok: boolean
  steps: { step: string; ok: boolean; output: string }[]
  devUrl?: string
  path?: string
}

export function BuildCard({ spec }: { spec: BuildSpec }) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(spec.questions.map((q) => [q.id, q.options[0]!]))
  )
  const [phase, setPhase] = useState<'clarify' | 'building' | 'done'>('clarify')
  const [result, setResult] = useState<ScaffoldResult | null>(null)

  async function build() {
    setPhase('building')
    const framework = (answers['framework'] ?? 'vue').toLowerCase()
    const typescript = (answers['typescript'] ?? '').toLowerCase().includes('type')
    try {
      const res = await fetch(`${amBase()}/api/code/scaffold`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ framework, typescript, name: 'app', workspace: `build-${Math.random().toString(36).slice(2, 8)}`, install: true, dev: true }),
        signal: AbortSignal.timeout(360_000),
      })
      setResult((await res.json()) as ScaffoldResult)
    } catch (e) {
      setResult({ ok: false, steps: [{ step: 'error', ok: false, output: String(e) }] })
    }
    setPhase('done')
  }

  return (
    <div className="mt-1 max-w-xl rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3.5">
      {phase === 'clarify' && (
        <>
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{spec.intro}</p>
          <div className="mt-3 space-y-2.5">
            {spec.questions.map((q) => (
              <div key={q.id}>
                <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">{q.label}</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {q.options.map((opt) => {
                    const active = answers[q.id] === opt
                    return (
                      <button key={opt} onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                        className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition ${active ? 'bg-[#1d4ed8] text-white' : 'border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'}`}>
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => void build()} className="mt-3 rounded-lg bg-[#7c3aed] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
            Build &amp; run it →
          </button>
        </>
      )}

      {phase === 'building' && (
        <div className="flex items-center gap-2.5 py-1">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#7c3aed] border-t-transparent" />
          <span className="text-[13px] text-[var(--color-text-secondary)]">Scaffolding · installing deps · starting the dev server… <span className="text-[var(--color-text-tertiary)]">(~1–2 min, all local)</span></span>
        </div>
      )}

      {phase === 'done' && result && (
        <>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: result.ok ? 'var(--color-accent)' : 'var(--color-attention)' }} />
            {result.ok ? 'Built and running' : 'Build hit a snag'}
          </p>
          <div className="mt-2 space-y-1">
            {result.steps.map((st, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[12px]">
                <span className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.ok ? 'var(--color-accent)' : '#dc2626' }} />
                <span className="text-[var(--color-text-secondary)]">{st.step}{st.output && !st.ok ? ` — ${st.output.slice(0, 120)}` : ''}</span>
              </div>
            ))}
          </div>
          {result.devUrl && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">{result.devUrl}</span>
                <button onClick={() => { if (result.devUrl) void openExternal(result.devUrl) }} className="rounded-lg bg-[#1d4ed8] px-2.5 py-1 text-[11px] font-semibold text-white">Open ↗</button>
              </div>
              <iframe src={result.devUrl} title="preview" className="mt-2 h-72 w-full rounded-xl border border-[var(--color-border-tertiary)] bg-white" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

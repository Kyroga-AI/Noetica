'use client'

import { useState } from 'react'
import type { ChatMessage } from '@/lib/types/message'
import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import { cleanSources } from '@/lib/chat/sources'
import { amUrl } from '@/lib/tauri/bridge'

// ── The Answer inspector ─────────────────────────────────────────────────────────────────────────
// Everything that used to be sprayed across a reply — verification, provenance, sources, governance,
// discipline, deliberation — moved into ONE dense, dashboard-style panel in the right rail. The chat
// stream stays a calm reading surface; this is the "pop the hood" view, shown only when the user clicks
// Inspect on a specific answer. Reads straight off the message; renders nothing it doesn't have.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border-tertiary)] px-4 py-3">
      <h4 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{title}</h4>
      {children}
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[12.5px]">
      <span className="shrink-0 text-[var(--color-text-tertiary)]">{k}</span>
      <span className={`min-w-0 truncate text-right text-[var(--color-text-primary)] tabular-nums ${mono ? 'font-mono text-[11.5px] text-[var(--color-text-secondary)]' : ''}`}>{v}</span>
    </div>
  )
}

// Export Proof — seal THIS answer into an offline-verifiable bundle and download it.
function ExportProofButton({ message }: { message: ChatMessage }) {
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  async function run() {
    setBusy(true); setState('idle')
    try {
      const res = await fetch(amUrl('/api/proof/export'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: message.id, answer: message.content,
          model: message.verification?.method || 'local', timestamp: message.created_at,
          verification: message.verification, citations: message.citations ?? [],
        }),
      })
      if (!res.ok) throw new Error('export failed')
      const bundle = await res.json()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href; a.download = `noetica-proof-${String(message.id).slice(0, 8)}.json`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href)
      setState('done'); setTimeout(() => setState('idle'), 1800)
    } catch { setState('error'); setTimeout(() => setState('idle'), 2500) }
    finally { setBusy(false) }
  }
  return (
    <button onClick={() => void run()} disabled={busy}
      className="flex-1 rounded-lg border border-[var(--color-border-secondary)] px-2 py-1.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50">
      {busy ? 'Sealing…' : state === 'done' ? 'Saved ✓' : state === 'error' ? 'Failed' : '⇩ Export proof'}
    </button>
  )
}

type GroundingRes = { grounded: boolean; score: number; supported: number; total: number; unsupported: string[]; no_sources?: boolean }
function GroundingCheckButton({ message }: { message: ChatMessage }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<GroundingRes | null>(null)
  const [failed, setFailed] = useState(false)
  async function run() {
    setBusy(true); setFailed(false); setRes(null)
    try {
      const r = await fetch(amUrl('/api/grounding/verify-answer'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: message.content }),
      })
      if (!r.ok) throw new Error('check failed')
      setRes(await r.json() as GroundingRes)
    } catch { setFailed(true) } finally { setBusy(false) }
  }
  return (
    <>
      <button onClick={() => void run()} disabled={busy}
        className="flex-1 rounded-lg border border-[var(--color-border-secondary)] px-2 py-1.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50">
        {busy ? 'Checking…' : failed ? 'Failed' : '◇ Check grounding'}
      </button>
      {res && (
        <div className="mt-2 w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-secondary)]">
          {res.no_sources ? 'No matching documents to check against.' : (
            <>
              <span className="font-medium text-[var(--color-text-primary)]">{res.supported}/{res.total}</span> sentences supported by your documents
              {res.unsupported.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {res.unsupported.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex gap-1 text-[#d97706]"><span aria-hidden>⚠</span><span className="min-w-0 flex-1">{s.length > 120 ? s.slice(0, 120) + '…' : s}</span></div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

export function AnswerInspectorPanel({ message }: { message: ChatMessage | null }) {
  if (!message || message.role !== 'assistant') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-[12.5px] text-[var(--color-text-tertiary)]">Click <span className="font-medium text-[var(--color-text-secondary)]">Inspect</span> on an answer to see how it was produced — verification, sources, and the full trace.</p>
      </div>
    )
  }

  const g = message.governance
  const prov = (g?.provider ?? '').toLowerCase()
  const onDevice = prov === '' || prov === 'ollama' || prov === 'noetica' || prov === 'local'
  const v = message.verification

  // sources: prefer cited documents, fall back to retrieval atoms — junk filtered out
  const docs = cleanSources(message.retrieval_trace?.document_sources)
  const atoms = cleanSources(message.retrieval_trace?.sources)
  const cites = message.citations ?? []
  const usedTotal = message.retrieval_trace?.sources?.length ?? 0

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Verification */}
      {v && (
        <Section title="Verification">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] text-[var(--color-text-primary)]">
            <span style={{ color: v.computed ? '#16a34a' : '#2563eb' }} aria-hidden>{v.computed ? '🔒' : '◆'}</span>
            <span>{v.badge}</span>
          </div>
          <Row k="method" v={v.method} />
          <Row k="replay" v={v.replayClass} />
          {v.attested && <Row k="seal" v={<span className="text-[#16a34a]">sealed onto evidence fabric</span>} />}
          {v.receiptRef && <Row k="receipt" v={v.receiptRef} mono />}
          <div className="mt-2.5 flex gap-2">
            <ExportProofButton message={message} />
            <GroundingCheckButton message={message} />
          </div>
        </Section>
      )}

      {/* Provenance */}
      {g && (
        <Section title="Provenance">
          <Row k="location" v={<span style={{ color: onDevice ? '#16a34a' : '#d97706' }}>{onDevice ? 'on-device' : `↗ ${prov}`}</span>} />
          {g.model_routed && <Row k="model" v={g.model_routed} />}
          {g.method && <Row k="method" v={g.method} />}
          {g.latency_ms > 0 && <Row k="latency" v={`${(g.latency_ms / 1000).toFixed(1)}s`} />}
          {(g.input_tokens || g.output_tokens) && <Row k="tokens" v={`${g.input_tokens?.toLocaleString() ?? '–'} in · ${g.output_tokens?.toLocaleString() ?? '–'} out`} />}
        </Section>
      )}

      {/* Sources */}
      {(docs.length > 0 || cites.length > 0 || atoms.length > 0) && (
        <Section title={`Sources${usedTotal ? ` · ${Math.max(docs.length, cites.length)} of ${usedTotal} atoms` : ''}`}>
          <div className="space-y-1.5">
            {(cites.length > 0
              ? cites.filter((c) => !!c.source).map((c) => ({ label: c.source, score: c.score }))
              : (docs.length > 0 ? docs : atoms)
            ).slice(0, 12).map((s, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[12px] text-[var(--color-text-secondary)]">
                <span className="w-3 shrink-0 text-[var(--color-text-tertiary)] tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{s.label || 'document'}</span>
                {typeof s.score === 'number' && <span className="shrink-0 text-[var(--color-text-tertiary)] tabular-nums">{(s.score * 100).toFixed(0)}%</span>}
              </div>
            ))}
          </div>
          {(message.retrieval_trace?.timings?.length ?? 0) > 0 && (
            <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
              retrieval: {message.retrieval_trace!.timings!.filter((t) => t.hits > 0).map((t) => `${t.pattern} ${t.hits} hits`).join(' · ') || 'no hits'}
            </p>
          )}
        </Section>
      )}

      {/* Discipline */}
      {message.discipline && (
        <Section title="Discipline">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">{message.discipline.posture}</span>
            {message.discipline.strategy && <span className="text-[var(--color-text-tertiary)]">→ {message.discipline.strategy}</span>}
            <span className="text-[var(--color-text-tertiary)]">conf {(message.discipline.calibrated_confidence * 100).toFixed(0)}%</span>
          </div>
          {message.discipline.barriers && message.discipline.barriers.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.discipline.barriers.map((b, i) => (
                <span key={i} className="rounded-full border border-[#fca5a5] bg-[#fef2f2] px-1.5 py-0.5 text-[9px] text-[#b91c1c]">{b}</span>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Deliberation */}
      {message.deliberation && (message.deliberation.candidates?.length ?? 0) > 1 && (
        <Section title={`Deliberation · best of ${message.deliberation.candidates?.length ?? 0}`}>
          {message.deliberation.candidates?.map((c) => (
            <Row key={c.rank}
              k={c.rank === message.deliberation!.selected_rank ? '✓ selected' : `#${c.rank + 1}`}
              v={`${(c.worth * 100).toFixed(0)}%`} />
          ))}
        </Section>
      )}

      {/* Value judgment */}
      {message.value_judgment && (
        <Section title="Value judgment">
          <Row k="verdict" v={message.value_judgment.verdict} />
          <Row k="worth" v={`${(message.value_judgment.worth * 100).toFixed(0)}%`} />
          <Row k="grounding" v={`${(message.value_judgment.grounding * 100).toFixed(0)}%`} />
        </Section>
      )}

      {/* Steering + full governance trail (kept for the audit case) */}
      {message.steering_result && (
        <Section title="Steering"><SteeringDiff result={message.steering_result} /></Section>
      )}
      {g && (
        <Section title="Governance trail"><GovernanceTrail trace={g} /></Section>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'

type PolicyMode = 'default' | 'strict' | 'permissive'
type EvidenceLevel = 'standard' | 'full_hash' | 'minimal'
type PolicyVerdict = 'admitted' | 'flagged' | 'blocked'

interface AuditEvent {
  id: string
  ts: string
  kind: 'session_init' | 'chat_request' | 'policy_check' | 'memory_read' | 'memory_write' | 'evidence_ref' | 'policy_emit'
  detail: string
  hash?: string
  verdict?: PolicyVerdict
}

interface EvidenceBundle {
  id: string
  hash: string
  source: string
  level: EvidenceLevel
  status: 'verified' | 'pending' | 'failed'
  createdAt: string
}

const KIND_LABELS: Record<AuditEvent['kind'], string> = {
  session_init: 'Session init',
  chat_request: 'Chat req',
  policy_check: 'Policy',
  memory_read:  'Mem read',
  memory_write: 'Mem write',
  evidence_ref: 'Evidence',
  policy_emit:  'Emit',
}

const KIND_COLOR: Record<AuditEvent['kind'], string> = {
  session_init: '#1d4ed8',
  chat_request: '#7c3aed',
  policy_check: '#f59e0b',
  memory_read:  '#0891b2',
  memory_write: '#0891b2',
  evidence_ref: '#16a34a',
  policy_emit:  '#1d4ed8',
}

const VERDICT_STYLE: Record<PolicyVerdict, string> = {
  admitted: 'bg-[rgba(34,197,94,0.12)] text-[#16a34a]',
  flagged:  'bg-[rgba(245,158,11,0.12)] text-[#d97706]',
  blocked:  'bg-[rgba(239,68,68,0.12)] text-[#dc2626]',
}

const BUNDLE_STATUS_STYLE: Record<EvidenceBundle['status'], string> = {
  verified: 'bg-[rgba(34,197,94,0.12)] text-[#16a34a]',
  pending:  'bg-[rgba(245,158,11,0.12)] text-[#d97706]',
  failed:   'bg-[rgba(239,68,68,0.12)] text-[#dc2626]',
}

const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  standard:  'Standard',
  full_hash: 'Full hash',
  minimal:   'Minimal',
}

const NOW = Date.now()

const SEED_EVENTS: AuditEvent[] = [
  { id: '1', ts: new Date(NOW - 18 * 60000).toISOString(), kind: 'session_init',  detail: 'Noetica session opened', hash: 'a1b2c3d4' },
  { id: '2', ts: new Date(NOW - 15 * 60000).toISOString(), kind: 'memory_read',   detail: 'noetica-eval · 3 entries loaded', hash: 'e5f6a7b8' },
  { id: '3', ts: new Date(NOW - 12 * 60000).toISOString(), kind: 'chat_request',  detail: 'claude-sonnet-4-6 · 1 message', hash: 'c9d0e1f2' },
  { id: '4', ts: new Date(NOW -  9 * 60000).toISOString(), kind: 'policy_check',  detail: 'Default policy · refusal check', hash: 'a3b4c5d6', verdict: 'admitted' },
  { id: '5', ts: new Date(NOW -  6 * 60000).toISOString(), kind: 'evidence_ref',  detail: 'SourceOS event #e-2041 linked', hash: 'f7g8h9i0' },
  { id: '6', ts: new Date(NOW -  3 * 60000).toISOString(), kind: 'memory_write',  detail: 'noetica-cowork · task decomposition stored', hash: 'j1k2l3m4' },
]

const SEED_BUNDLES: EvidenceBundle[] = [
  { id: '1', hash: 'sha256:a1b2c3d4e5f6', source: 'SourceOS event #e-2041', level: 'standard',  status: 'verified', createdAt: new Date(NOW - 6 * 60000).toISOString() },
  { id: '2', hash: 'sha256:7c8d9e0f1a2b', source: 'Chat session · noetica-eval', level: 'full_hash', status: 'pending', createdAt: new Date(NOW - 2 * 60000).toISOString() },
]

const EVENT_TEMPLATES: Array<{ kind: AuditEvent['kind']; detail: string; verdict?: PolicyVerdict }> = [
  { kind: 'chat_request',  detail: 'claude-sonnet-4-6 · 2 messages' },
  { kind: 'policy_check',  detail: 'Strict policy · content filter', verdict: 'admitted' },
  { kind: 'memory_read',   detail: 'noetica-cowork · 2 entries loaded' },
  { kind: 'evidence_ref',  detail: 'SourceOS event #e-2043 linked' },
  { kind: 'policy_emit',   detail: 'Policy verdict emitted → admitted', verdict: 'admitted' },
  { kind: 'memory_write',  detail: 'noetica-tune · preference pair stored' },
  { kind: 'policy_check',  detail: 'Default policy · attribution check', verdict: 'flagged' },
]

function fakeHash() {
  return Math.random().toString(16).slice(2, 10)
}

export function GovernSurface() {
  const [policyMode, setPolicyMode]       = useState<PolicyMode>('default')
  const [evidenceLevel, setEvidenceLevel] = useState<EvidenceLevel>('standard')
  const [events, setEvents]               = useState<AuditEvent[]>(SEED_EVENTS)
  const [bundles]                         = useState<EvidenceBundle[]>(SEED_BUNDLES)
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [generating, setGenerating]       = useState(false)

  const scopeCounts = {
    session: events.filter((e) => e.kind === 'chat_request' || e.kind === 'policy_check').length,
    project: 12 + events.filter((e) => e.kind === 'memory_write').length,
    global:  7,
  }

  function generateTrace() {
    if (generating) return
    setGenerating(true)
    setTimeout(() => {
      const t = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)]
      setEvents((prev) => [...prev, {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        kind: t.kind,
        detail: t.detail,
        hash: fakeHash(),
        verdict: t.verdict,
      }])
      setGenerating(false)
    }, 700)
  }

  function exportAuditTrail() {
    const data = JSON.stringify({ policy: policyMode, evidenceLevel, events, bundles }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `noetica_audit_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">

        {/* Policy profile */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Policy profile</div>
          <div className="mt-3 flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">Mode</span>
              {([['default', 'Default'], ['strict', 'Strict'], ['permissive', 'Permissive']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setPolicyMode(val)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    policyMode === val
                      ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.12)] font-semibold text-[#1d4ed8]'
                      : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
                  }`}
                >{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">Evidence</span>
              {([['minimal', 'Minimal'], ['standard', 'Standard'], ['full_hash', 'Full hash']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setEvidenceLevel(val)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    evidenceLevel === val
                      ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.12)] font-semibold text-[#1d4ed8]'
                      : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-[var(--color-background-secondary)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
            {policyMode === 'default'    && 'Standard: refusal check active, evidence refs required for factual claims.'}
            {policyMode === 'strict'     && 'Legal-grade: full hash provenance, mandatory evidence bundles, all outputs reviewed before emit.'}
            {policyMode === 'permissive' && 'Research mode: minimal restrictions, policy checks recorded but non-blocking.'}
          </div>
        </div>

        {/* Memory scope */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Memory scope</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(['session', 'project', 'global'] as const).map((scope) => (
              <div key={scope} className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4 text-center">
                <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{scopeCounts[scope]}</div>
                <div className="mt-0.5 text-xs font-medium capitalize text-[var(--color-text-secondary)]">{scope}</div>
                <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">entries</div>
              </div>
            ))}
          </div>
        </div>

        {/* Audit trail */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Audit trail</div>
            <div className="flex items-center gap-2">
              <button
                onClick={generateTrace}
                disabled={generating}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] disabled:opacity-50"
              >
                {generating ? (
                  <><span className="h-1.5 w-1.5 rounded-full bg-[#1d4ed8] animate-pulse" /> Generating…</>
                ) : '+ Trace'}
              </button>
              <button
                onClick={exportAuditTrail}
                className="rounded-full bg-[rgba(29,78,216,0.10)] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[rgba(29,78,216,0.18)]"
              >
                Export JSON
              </button>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border-tertiary)]">
            {events.map((ev) => (
              <div key={ev.id}>
                <button
                  onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-[var(--color-background-secondary)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[ev.kind] }} />
                  <span className="w-20 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    {KIND_LABELS[ev.kind]}
                  </span>
                  <span className="flex-1 truncate text-xs text-[var(--color-text-primary)]">{ev.detail}</span>
                  {ev.verdict && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${VERDICT_STYLE[ev.verdict]}`}>
                      {ev.verdict}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-tertiary)]">
                    {new Date(ev.ts).toLocaleTimeString()}
                  </span>
                </button>
                {expandedId === ev.id && (
                  <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-5 py-3">
                    <div className="flex flex-wrap gap-5 text-[11px]">
                      <div><span className="text-[var(--color-text-tertiary)]">Hash </span><span className="font-mono text-[var(--color-text-primary)]">{ev.hash ?? '—'}</span></div>
                      <div><span className="text-[var(--color-text-tertiary)]">Policy </span><span className="font-mono text-[var(--color-text-primary)]">{policyMode}</span></div>
                      <div><span className="text-[var(--color-text-tertiary)]">Evidence </span><span className="font-mono text-[var(--color-text-primary)]">{evidenceLevel}</span></div>
                      <div><span className="text-[var(--color-text-tertiary)]">Timestamp </span><span className="font-mono text-[var(--color-text-primary)]">{new Date(ev.ts).toLocaleString()}</span></div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Evidence bundles */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Evidence bundles</div>
          </div>
          <div className="divide-y divide-[var(--color-border-tertiary)]">
            {bundles.length === 0 && (
              <div className="px-5 py-6 text-sm text-[var(--color-text-tertiary)]">No evidence bundles yet.</div>
            )}
            {bundles.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[var(--color-text-primary)]">{b.source}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--color-text-tertiary)]">{b.hash}</div>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--color-border-tertiary)] px-2 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">
                  {EVIDENCE_LEVEL_LABEL[b.level]}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${BUNDLE_STATUS_STYLE[b.status]}`}>
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

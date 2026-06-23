'use client'

import { useEffect, useState } from 'react'
import { buildEgressAudit, toCsv } from '@/lib/governance/egressAudit'
import type { GovernanceTrace } from '@/lib/types/governance'
import { readLedgerEntries, clearLedger, type LedgerEntry } from '@/lib/evidence/ledger-store'
import { useSettings } from '@/lib/settings/context'

type PolicyMode = 'default' | 'strict' | 'permissive'
type EvidenceLevel = 'standard' | 'full_hash' | 'minimal'
type PolicyVerdict = 'admitted' | 'flagged' | 'blocked'

interface AuditEvent {
  id: string
  ts: string
  kind: 'session_init' | 'chat_request' | 'tool_call' | 'policy_check' | 'memory_read' | 'memory_write' | 'evidence_ref' | 'policy_emit'
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
  tool_call:    'Tool call',
  policy_check: 'Policy',
  memory_read:  'Mem read',
  memory_write: 'Mem write',
  evidence_ref: 'Evidence',
  policy_emit:  'Emit',
}

const KIND_COLOR: Record<AuditEvent['kind'], string> = {
  session_init: '#1d4ed8',
  chat_request: '#7c3aed',
  tool_call:    '#9333ea',
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

function ledgerToAuditEvent(e: LedgerEntry): AuditEvent {
  const detail = e.kind === 'chat_request'
    ? `${e.model_id} · ${e.latency_ms}ms${e.input_tokens ? ` · ${e.input_tokens}→${e.output_tokens ?? 0} tok` : ''}`
    : e.kind === 'policy_check'
    ? `${e.policy_profile ?? 'default'} policy · ${e.policy_admitted ? 'admitted' : 'blocked'}`
    : e.kind === 'session_init'
    ? 'Noetica session opened'
    : e.content_preview || e.kind
  return {
    id: e.id,
    ts: e.timestamp,
    kind: e.kind === 'error' ? 'policy_check' : e.kind === 'benchmark_result' ? 'tool_call' : e.kind,
    detail,
    hash: e.evidence_hash?.slice(0, 8),
    verdict: e.kind === 'policy_check' || e.kind === 'chat_request'
      ? (e.policy_admitted === false ? 'blocked' : 'admitted')
      : undefined,
  }
}

function ledgerToBundles(entries: LedgerEntry[], level: EvidenceLevel): EvidenceBundle[] {
  return entries
    .filter((e) => e.evidence_hash)
    .map((e) => ({
      id: e.id,
      hash: e.evidence_hash!,
      source: `${e.model_id} · ${e.session_id.slice(0, 12)}`,
      level,
      status: e.policy_admitted === false ? ('failed' as const) : ('verified' as const),
      createdAt: e.timestamp,
    }))
    .slice(0, 20)
}

type RunTrace = { messageId: string; content: string; governance: GovernanceTrace }

interface AgentMachineRun {
  run_id: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_written: boolean
  timestamp: string
  latency_ms: number
  tokens_egressed?: number
  cost_usd?: number
  task?: string
  session_id?: string
  error?: string
}

interface MemoryRecord { id: string; kind: string; createdAt: string; preview: string; pinned: boolean; lti: number }
interface BanditArm { task: string; provider: string; model: string; plays: number; mean_reward: number; leading: boolean }
interface MeshTrends {
  quality?: { delta: number; improving: boolean; samples: number }
  bandit?: BanditArm[]
  graph?: { total_edges: number; derived_edges: number }
}

interface LearningStats {
  skills: { count: number; recent: Array<{ task: string; abstraction: string; steps: string[] }> }
  evalCases: { count: number; recent: Array<{ input: string; failureMode: string; coverage: number }> }
}

interface DreamResult {
  seeds: number; nodes: number; proposed: number; integrated: number
  top: Array<{ from: string; to: string; via: string[]; support: number }>
}

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

function amRunToAuditEvent(r: AgentMachineRun): AuditEvent {
  const detail = r.error
    ? `${r.model_routed} · ${r.latency_ms}ms · ERROR: ${r.error.slice(0, 80)}`
    : `${r.model_routed} · ${r.latency_ms}ms · ${r.task ?? 'chat'}`
  return {
    id: r.run_id,
    ts: r.timestamp,
    kind: 'chat_request',
    detail,
    verdict: r.policy_admitted ? 'admitted' : 'blocked',
  }
}

export function GovernSurface({ recentTraces = [] }: { recentTraces?: RunTrace[] }) {
  const { settings, update: updateSettings } = useSettings()
  const [policyMode, setPolicyMode]   = useState<PolicyMode>(
    (['default', 'strict', 'permissive'] as string[]).includes(settings.defaultPolicyProfile)
      ? settings.defaultPolicyProfile as PolicyMode
      : 'default'
  )
  const [evidenceLevel, setEvidenceLevel] = useState<EvidenceLevel>(
    (settings.defaultEvidenceLevel === 'full' ? 'full_hash' : settings.defaultEvidenceLevel) as EvidenceLevel ?? 'standard'
  )
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [confirmClear, setConfirmClear]   = useState(false)
  const [amRuns, setAmRuns]               = useState<AgentMachineRun[]>([])
  const [trends, setTrends]               = useState<MeshTrends | null>(null)
  const [memories, setMemories]           = useState<MemoryRecord[]>([])
  const [learning, setLearning]           = useState<LearningStats | null>(null)
  const [dream, setDream]                 = useState<DreamResult | null>(null)
  const [dreaming, setDreaming]           = useState(false)
  const [filterVerdict, setFilterVerdict] = useState<'all' | PolicyVerdict>('all')
  const [filterModel, setFilterModel]     = useState<string>('all')

  useEffect(() => {
    readLedgerEntries(200).then((entries) => {
      setLedgerEntries(entries)
      setLedgerLoading(false)
    })
    // Fetch persisted runs from agent-machine ring buffer
    fetch(amUrl('/api/governance/recent?limit=50'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((data: { runs?: AgentMachineRun[] } | null) => {
        if (data?.runs?.length) setAmRuns(data.runs)
      })
      .catch(() => { /* agent-machine not running — silently skip */ })
    // What the mesh has LEARNED — bandit routing convergence + quality trend + symbolic growth
    fetch(amUrl('/api/self/trends'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: MeshTrends | null) => { if (d) setTrends(d) })
      .catch(() => { /* not running — skip */ })
    // Production-learning loop: skills distilled from successes + failures captured for replay.
    fetch(amUrl('/api/learning/stats'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: LearningStats | null) => { if (d) setLearning(d) })
      .catch(() => { /* not running — skip */ })
    // Dreaming: preview consolidated associations (GET = no writes).
    fetch(amUrl('/api/dream'), { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: DreamResult | null) => { if (d) setDream(d) })
      .catch(() => { /* not running — skip */ })
    loadMemories()
  }, [])

  // Trigger a consolidation pass that PERSISTS the strongest proposals (POST = integrate).
  async function runDream() {
    setDreaming(true)
    try {
      const r = await fetch(amUrl('/api/dream'), { method: 'POST', signal: AbortSignal.timeout(20000) })
      if (r.ok) setDream(await r.json() as DreamResult)
    } catch { /* skip */ } finally { setDreaming(false) }
  }

  function loadMemories() {
    fetch(amUrl('/api/memory/graph'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { memories?: MemoryRecord[] } | null) => { if (d?.memories) setMemories(d.memories) })
      .catch(() => { /* not running — skip */ })
  }

  // Curate the long-term brain: pin (inject into recall) / forget (soft-delete). Optimistic.
  async function pinMemory(id: string, pinned: boolean) {
    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, pinned } : m)))
    try { await fetch(amUrl('/api/memory/pin'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, pinned }) }) }
    catch { loadMemories() }
  }
  async function forgetMemory(id: string) {
    setMemories((ms) => ms.filter((m) => m.id !== id))
    try { await fetch(amUrl('/api/memory/forget'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }) }
    catch { loadMemories() }
  }

  // Merge local ledger events with agent-machine run history, deduped by id, sorted newest-first
  const amEvents: AuditEvent[] = amRuns.map(amRunToAuditEvent)
  const seenIds = new Set(ledgerEntries.map(e => e.id))
  const allEvents: AuditEvent[] = [
    // benchmark_result entries belong to the Evaluate dashboard, not the audit trail
    ...ledgerEntries.filter((e) => e.kind !== 'benchmark_result').map(ledgerToAuditEvent),
    ...amEvents.filter(e => !seenIds.has(e.id)),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  // Analytics derived from amRuns
  const chatRuns = amRuns.filter(r => r.model_routed)
  const admittedCount  = chatRuns.filter(r => r.policy_admitted).length
  const admissionRate  = chatRuns.length > 0 ? (admittedCount / chatRuns.length) * 100 : 0
  const avgLatency     = chatRuns.length > 0 ? chatRuns.reduce((s, r) => s + r.latency_ms, 0) / chatRuns.length : 0
  const modelCounts    = chatRuns.reduce<Record<string, number>>((acc, r) => {
    const m = r.model_routed.split(':')[0] ?? r.model_routed
    acc[m] = (acc[m] ?? 0) + 1
    return acc
  }, {})
  const modelList      = Object.entries(modelCounts).sort(([, a], [, b]) => b - a)
  const uniqueModels   = ['all', ...modelList.map(([m]) => m)]

  // Apply filters
  const events = allEvents.filter(ev => {
    if (filterVerdict !== 'all' && ev.verdict && ev.verdict !== filterVerdict) return false
    if (filterModel !== 'all' && ev.kind === 'chat_request') {
      if (!ev.detail.toLowerCase().includes(filterModel.toLowerCase())) return false
    }
    return true
  })

  const bundles: EvidenceBundle[] = ledgerToBundles(ledgerEntries, evidenceLevel)

  // Build run traces from agent-machine history if session has none
  const allTraces: RunTrace[] = recentTraces.length > 0
    ? recentTraces
    : amRuns.slice(0, 20).map(r => ({
        messageId: r.run_id,
        content: `${r.model_routed} · ${r.task ?? 'chat'}`,
        governance: {
          run_id: r.run_id,
          model_routed: r.model_routed,
          provider: r.provider,
          policy_admitted: r.policy_admitted,
          memory_written: r.memory_written,
          timestamp: r.timestamp,
          latency_ms: r.latency_ms,
          agent_machine: true,
          agent_machine_version: '0.4.11',
        } as GovernanceTrace,
      }))

  function syncPolicyMode(mode: PolicyMode) {
    setPolicyMode(mode)
    updateSettings({ defaultPolicyProfile: mode })
  }
  function syncEvidenceLevel(level: EvidenceLevel) {
    setEvidenceLevel(level)
    updateSettings({ defaultEvidenceLevel: level === 'full_hash' ? 'full' : level as 'minimal' | 'standard' })
  }

  function refreshLedger() {
    setLedgerLoading(true)
    readLedgerEntries(200).then((entries) => {
      setLedgerEntries(entries)
      setLedgerLoading(false)
    })
  }

  const scopeCounts = {
    session: ledgerEntries.filter((e) => e.kind === 'chat_request').length + amRuns.length,
    project: ledgerEntries.filter((e) => e.kind === 'memory_write').length,
    global:  ledgerEntries.filter((e) => e.evidence_hash).length,
  }

  function exportAuditTrail() {
    const data = JSON.stringify({ policy: policyMode, evidenceLevel, events: ledgerEntries, bundles }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `noetica_audit_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const egressAudit = buildEgressAudit(amRuns)
  function downloadEgressAudit(format: 'csv' | 'json') {
    const data = format === 'csv' ? toCsv(egressAudit) : JSON.stringify(egressAudit, null, 2)
    const blob = new Blob([data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `noetica_egress_audit_${Date.now()}.${format}`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">

        {/* Production-learning loop — what the agent has learned from real turns */}
        {learning && (learning.skills.count > 0 || learning.evalCases.count > 0) && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8] mb-3">Learning loop</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[#16a34a]">{learning.skills.count}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Skills from successes</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[#d97706]">{learning.evalCases.count}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Failures captured for replay</div>
              </div>
            </div>
            {learning.skills.recent.length > 0 && (
              <ul className="space-y-1">
                {learning.skills.recent.slice().reverse().map((s, i) => (
                  <li key={i} className="truncate text-[11px] text-[var(--color-text-secondary)]" title={`${s.abstraction}: ${s.steps.join(' → ')}`}>
                    <span className="text-[var(--color-text-tertiary)]">↳</span> {s.abstraction || s.task}: <span className="text-[var(--color-text-tertiary)]">{s.steps.slice(0, 5).join(' → ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Dreaming — offline generative consolidation (associations the graph doesn't have yet) */}
        {dream && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c3aed]">Dreaming</div>
              <button onClick={() => void runDream()} disabled={dreaming}
                className="rounded-lg border border-[#ddd6fe] bg-[#f5f3ff] px-2.5 py-1 text-[10px] font-semibold text-[#6d28d9] transition hover:bg-[#ede9fe] disabled:opacity-50">
                {dreaming ? 'Dreaming…' : '✦ Dream now'}
              </button>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[#7c3aed]">{dream.proposed}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Associations proposed</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[#16a34a]">{dream.integrated}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Integrated (support ≥ 2)</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{dream.seeds}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Seed concepts</div>
              </div>
            </div>
            {dream.top.length > 0 ? (
              <ul className="space-y-1">
                {dream.top.slice(0, 6).map((p, i) => (
                  <li key={i} className="truncate text-[11px] text-[var(--color-text-secondary)]" title={`${p.from} ↔ ${p.to} (via ${p.via.join(' → ')}, support ${p.support})`}>
                    <span className="text-[#7c3aed]">✦</span> {p.from} <span className="text-[var(--color-text-tertiary)]">↔</span> {p.to}
                    <span className="ml-1 text-[10px] text-[var(--color-text-tertiary)]">via {p.via.slice(0, 3).join(' → ') || 'direct walk'} · ×{p.support}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[11px] text-[var(--color-text-tertiary)]">No novel associations surfaced yet — the graph grows them as you work.</div>
            )}
          </div>
        )}

        {/* Analytics metrics */}
        {chatRuns.length > 0 && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8] mb-3">Analytics</div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{chatRuns.length}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Total runs</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className={`text-2xl font-semibold ${admissionRate > 90 ? 'text-[#16a34a]' : admissionRate > 70 ? 'text-[#d97706]' : 'text-[#dc2626]'}`}>{admissionRate.toFixed(0)}%</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Admission rate</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{(avgLatency / 1000).toFixed(1)}s</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Avg latency</div>
              </div>
            </div>
            {modelList.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">Model breakdown</div>
                <div className="space-y-1.5">
                  {modelList.map(([model, count]) => (
                    <div key={model} className="flex items-center gap-2">
                      <span className="w-28 truncate text-[11px] text-[var(--color-text-secondary)]">{model}</span>
                      <div className="h-1.5 flex-1 rounded-full bg-[var(--color-background-tertiary)] overflow-hidden">
                        <div className="h-full rounded-full bg-[#1d4ed8]" style={{ width: `${(count / chatRuns.length) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sovereignty — egress audit (procurement artifact: what left the device, when, why) */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Sovereignty · egress audit</div>
            <div className="flex gap-1.5">
              <button onClick={() => downloadEgressAudit('csv')} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]">Export CSV</button>
              <button onClick={() => downloadEgressAudit('json')} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]">JSON</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
              <div className={`text-2xl font-semibold ${egressAudit.summary.sovereignty_pct === 100 ? 'text-[#16a34a]' : egressAudit.summary.sovereignty_pct >= 80 ? 'text-[#d97706]' : 'text-[#dc2626]'}`}>{egressAudit.summary.sovereignty_pct}%</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">on-device (sovereign)</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
              <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{egressAudit.summary.egress_runs}</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">runs that left device</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
              <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{egressAudit.summary.total_tokens_egressed.toLocaleString()}</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">tokens egressed</div>
            </div>
          </div>
          {egressAudit.rows.length === 0 ? (
            <div className="mt-3 rounded-lg border border-[#86efac] bg-[#dcfce7] px-3 py-2 text-[11px] font-medium text-[#16a34a]">🔒 Zero egress — nothing has left this device.</div>
          ) : (
            <div className="mt-3 space-y-1">
              {egressAudit.rows.slice(0, 8).map((r) => (
                <div key={r.run_id} className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
                  <span className="text-[#d97706]">↗</span>
                  <span className="w-36 truncate">{r.provider}/{r.model}</span>
                  <span className="tabular-nums">{r.tokens_egressed.toLocaleString()} tok</span>
                  <span className={r.policy === 'admitted' ? 'text-[var(--color-text-tertiary)]' : 'font-medium text-[#dc2626]'}>{r.policy}</span>
                  <span className="ml-auto text-[var(--color-text-tertiary)]">{r.when.slice(0, 16).replace('T', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Memory — curate the long-term brain: pin to inject into recall, forget to drop. The
            curatable graph memory no competitor ships (you asked: "curate memories into the brain"). */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Memory</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">{memories.filter((m) => m.pinned).length} pinned · {memories.length} total</div>
          </div>
          <div className="mb-3 text-[11px] text-[var(--color-text-tertiary)]">What the agent remembers about you. ★ Pin to keep it in long-term recall; × to forget it. This is yours to curate — nothing leaves the device.</div>
          {memories.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">No memories yet — the agent writes these as it learns your preferences and facts.</div>
          ) : (
            <div className="space-y-1.5">
              {[...memories].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lti - a.lti).slice(0, 12).map((m) => (
                <div key={m.id} className="flex items-start gap-2 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-2.5">
                  <button onClick={() => pinMemory(m.id, !m.pinned)} title={m.pinned ? 'Unpin from long-term recall' : 'Pin into long-term recall'} className={`mt-0.5 text-sm leading-none ${m.pinned ? 'text-[#d97706]' : 'text-[var(--color-text-tertiary)] hover:text-[#d97706]'}`}>{m.pinned ? '★' : '☆'}</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[var(--color-background-tertiary)] px-1 text-[9px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{m.kind}</span>
                      <span className="text-[9px] text-[var(--color-text-tertiary)]">{new Date(m.createdAt).toLocaleDateString()}</span>
                      {m.pinned && <span className="text-[9px] font-medium text-[#d97706]">in long-term recall</span>}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-text-secondary)]">{m.preview}</div>
                  </div>
                  <button onClick={() => forgetMemory(m.id)} title="Forget this memory" className="mt-0.5 text-sm leading-none text-[var(--color-text-tertiary)] hover:text-[#dc2626]">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mesh learning — the verifier→selection loop made visible (introspection cloud chat lacks) */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Mesh learning</div>
          <div className="mb-3 text-[11px] text-[var(--color-text-tertiary)]">What the local mesh has taught itself — which model wins each task, whether answers are improving, and the symbolic substrate growing.</div>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
              <div className={`text-2xl font-semibold ${(trends?.quality?.delta ?? 0) > 0 ? 'text-[#16a34a]' : (trends?.quality?.delta ?? 0) < 0 ? 'text-[#dc2626]' : 'text-[var(--color-text-primary)]'}`}>
                {trends?.quality ? `${trends.quality.delta > 0 ? '↑' : trends.quality.delta < 0 ? '↓' : '·'} ${(trends.quality.delta * 100).toFixed(0)}%` : '—'}
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">answer quality{trends?.quality ? ` · ${trends.quality.samples} samples` : ''}</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
              <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{(trends?.graph?.total_edges ?? 0).toLocaleString()}</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">graph edges</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
              <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{(trends?.graph?.derived_edges ?? 0).toLocaleString()}</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">inferred (symbolic)</div>
            </div>
          </div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Learned routing (UCB bandit)</div>
          {trends?.bandit && trends.bandit.length > 0 ? (
            <div className="space-y-1.5">
              {trends.bandit.map((a) => (
                <div key={`${a.task}/${a.model}`} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 shrink-0 truncate text-[var(--color-text-tertiary)]">{a.task}</span>
                  <span className={`w-36 shrink-0 truncate ${a.leading ? 'font-semibold text-[#16a34a]' : 'text-[var(--color-text-secondary)]'}`}>{a.leading ? '⭐ ' : ''}{a.model}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                    <div className={`h-full rounded-full ${a.leading ? 'bg-[#16a34a]' : 'bg-[#94a3b8]'}`} style={{ width: `${Math.max(2, Math.min(100, a.mean_reward * 100))}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{a.mean_reward.toFixed(2)} · {a.plays}×</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">No routing learned yet — the bandit converges as you use local models across varied tasks. Every judged answer updates an arm.</div>
          )}
        </div>

        {/* Policy profile */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Policy profile</div>
          <div className="mt-3 flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">Mode</span>
              {([['default', 'Default'], ['strict', 'Strict'], ['permissive', 'Permissive']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => syncPolicyMode(val)}
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
                  onClick={() => syncEvidenceLevel(val)}
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

        {/* Run details — current session + agent-machine history */}
        {allTraces.length > 0 && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] shadow-sm">
            <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Run Details</div>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{allTraces.length} run{allTraces.length !== 1 ? 's' : ''}{recentTraces.length === 0 && amRuns.length > 0 ? ' (from history)' : ' this session'}</p>
            </div>
            <div className="divide-y divide-[var(--color-border-tertiary)]">
              {[...allTraces].reverse().map((trace, idx) => {
                const g = trace.governance
                const [expanded, setExpanded] = [
                  expandedId === trace.messageId,
                  (v: string | null) => setExpandedId(v),
                ]
                return (
                  <div key={trace.messageId}>
                    <button
                      onClick={() => setExpanded(expanded ? null : trace.messageId)}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-[var(--color-background-secondary)]"
                    >
                      <span className="w-5 shrink-0 text-center text-[10px] font-mono text-[var(--color-text-tertiary)]">#{allTraces.length - idx}</span>
                      <span className="flex-1 truncate text-xs text-[var(--color-text-primary)]">{trace.content || '…'}</span>
                      <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{g.latency_ms > 0 ? `${(g.latency_ms / 1000).toFixed(1)}s` : ''}</span>
                      {(g.input_tokens || g.output_tokens) && (
                        <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                          {g.input_tokens?.toLocaleString() ?? '–'}/{g.output_tokens?.toLocaleString() ?? '–'}
                        </span>
                      )}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${g.policy_admitted ? VERDICT_STYLE.admitted : VERDICT_STYLE.blocked}`}>
                        {g.policy_admitted ? 'admitted' : 'blocked'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-5 py-3">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                          <div><span className="text-[var(--color-text-tertiary)]">Run ID </span><span className="font-mono text-[var(--color-text-primary)]">{g.run_id?.slice(0, 16) ?? '—'}</span></div>
                          <div><span className="text-[var(--color-text-tertiary)]">Model </span><span className="font-mono text-[var(--color-text-primary)]">{g.model_routed ?? '—'}</span></div>
                          <div><span className="text-[var(--color-text-tertiary)]">Provider </span><span className="font-mono text-[var(--color-text-primary)]">{g.provider ?? '—'}</span></div>
                          <div><span className="text-[var(--color-text-tertiary)]">Latency </span><span className="font-mono text-[var(--color-text-primary)]">{g.latency_ms}ms</span></div>
                          {g.input_tokens !== undefined && (
                            <div><span className="text-[var(--color-text-tertiary)]">Tokens in </span><span className="font-mono text-[var(--color-text-primary)]">{g.input_tokens.toLocaleString()}</span></div>
                          )}
                          {g.output_tokens !== undefined && (
                            <div><span className="text-[var(--color-text-tertiary)]">Tokens out </span><span className="font-mono text-[var(--color-text-primary)]">{g.output_tokens.toLocaleString()}</span></div>
                          )}
                          <div><span className="text-[var(--color-text-tertiary)]">Memory scope </span><span className="font-mono text-[var(--color-text-primary)]">{g.memory_scope_ref ?? '—'}</span></div>
                          <div><span className="text-[var(--color-text-tertiary)]">Memory written </span><span className="font-mono text-[var(--color-text-primary)]">{String(g.memory_written)}</span></div>
                          {g.request_hash && (
                            <div className="col-span-2"><span className="text-[var(--color-text-tertiary)]">Request hash </span><span className="font-mono text-[var(--color-text-primary)]">{g.request_hash.slice(0, 32)}…</span></div>
                          )}
                          {g.evidence_hash && (
                            <div className="col-span-2"><span className="text-[var(--color-text-tertiary)]">Evidence hash </span><span className="font-mono text-[var(--color-text-primary)]">{g.evidence_hash.slice(0, 32)}…</span></div>
                          )}
                          {g.timestamp && (
                            <div className="col-span-2"><span className="text-[var(--color-text-tertiary)]">Timestamp </span><span className="font-mono text-[var(--color-text-primary)]">{new Date(g.timestamp).toLocaleString()}</span></div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
          <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Audit trail</div>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{events.length} event{events.length !== 1 ? 's' : ''}{(filterVerdict !== 'all' || filterModel !== 'all') ? ' (filtered)' : ''}</span>
              </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshLedger}
                disabled={ledgerLoading}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8] disabled:opacity-50"
              >
                {ledgerLoading ? <span className="h-1.5 w-1.5 rounded-full bg-[#1d4ed8] animate-pulse" /> : '↻'} Refresh
              </button>
            </div>
            </div>
            {/* Filter bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Filter:</span>
              {(['all', 'admitted', 'flagged', 'blocked'] as const).map((v) => (
                <button key={v} onClick={() => setFilterVerdict(v)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] capitalize transition ${filterVerdict === v ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.10)] font-semibold text-[#1d4ed8]' : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'}`}>
                  {v}
                </button>
              ))}
              {uniqueModels.length > 2 && uniqueModels.slice(0, 6).map((m) => (
                <button key={m} onClick={() => setFilterModel(m)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition ${filterModel === m ? 'border-[#7c3aed] bg-[rgba(124,58,237,0.10)] font-semibold text-[#7c3aed]' : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'}`}>
                  {m === 'all' ? 'All models' : m}
                </button>
              ))}
            </div>
          <div className="flex items-center gap-2 mt-0">
              {events.length > 0 && (
                <button
                  onClick={exportAuditTrail}
                  className="rounded-full bg-[rgba(29,78,216,0.10)] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[rgba(29,78,216,0.18)]"
                >
                  Export JSON
                </button>
              )}
              {events.length > 0 && (
                confirmClear ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#dc2626]">Clear {events.length}?</span>
                    <button onClick={() => { void clearLedger().then(refreshLedger); setConfirmClear(false) }}
                      className="text-[10px] font-semibold text-[#dc2626] hover:underline">Yes</button>
                    <button onClick={() => setConfirmClear(false)}
                      className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmClear(true)}
                    className="rounded-full border border-[#fecaca] px-3 py-1 text-[10px] text-[#dc2626] transition hover:bg-[#fef2f2]">
                    Clear
                  </button>
                )
              )}
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border-tertiary)]">
            {events.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-[var(--color-text-tertiary)]">
                {ledgerLoading ? 'Loading audit trail…' : 'No events yet. Start a conversation in the Chat surface to populate the audit trail.'}
              </div>
            )}
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

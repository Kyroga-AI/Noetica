'use client'

import { useEffect, useRef, useState } from 'react'
import { buildEgressAudit, toCsv } from '@/lib/governance/egressAudit'
import AutonomyPanel from '@/components/governance/AutonomyPanel'
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
  skills: { count: number; due: number; recent: Array<{ task: string; abstraction: string; steps: string[] }> }
  evalCases: { count: number; recent: Array<{ input: string; failureMode: string; coverage: number }> }
  experiences: { count: number }
  replay?: { total: number; fixed: number; stillFailing: number; fixedRate: number; ts: number } | null
}

interface DreamResult {
  seeds: number; nodes: number; proposed: number; integrated: number
  top: Array<{ from: string; to: string; via: string[]; support: number }>
}

interface GraphProposal {
  id: string
  op: 'add-node' | 'add-edge' | 'remove-edge' | 'update-prop'
  payload: Record<string, unknown>
  rationale: string
  source?: string
  status: 'pending' | 'accepted' | 'rejected'
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

interface AuditAttestation { attested: boolean; entries: number; chainValid: boolean; signed: boolean; signatureValid: boolean; firstBreakAt?: number; fingerprint: string; headHash: string }

interface HierarchyTier { level: string; label: string; description: string; active: boolean }
interface GovernancePosture {
  killSwitchArmed: boolean
  killSwitchReason: string | null
  scopedConfigured: boolean
  policyId: string | null
  policyName: string | null
  authorityHierarchy: HierarchyTier[]
  escalationActionClasses: string[]
  escalationNote: string
}

const TIER_COLOR: Record<string, { dot: string; chip: string; label: string }> = {
  root:      { dot: '#dc2626', chip: 'bg-[rgba(220,38,38,0.10)] text-[#dc2626]',   label: 'Root' },
  system:    { dot: '#7c3aed', chip: 'bg-[rgba(124,58,237,0.10)] text-[#7c3aed]',  label: 'System' },
  developer: { dot: '#1d4ed8', chip: 'bg-[rgba(29,78,216,0.10)] text-[#1d4ed8]',   label: 'Developer' },
  user:      { dot: '#0891b2', chip: 'bg-[rgba(8,145,178,0.10)] text-[#0891b2]',   label: 'User' },
  guideline: { dot: '#16a34a', chip: 'bg-[rgba(22,163,74,0.10)] text-[#16a34a]',   label: 'Guideline' },
}

function traceDreamAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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

  // Trace consolidation dreaming — turns recent experiences into distilled skills offline
  interface TraceDreamResult { lastRun: string | null; extracted: number; skills?: Array<{ task: string; abstraction: string; steps: string[] }> }
  const [traceDream, setTraceDream]       = useState<TraceDreamResult | null>(null)
  const [traceDreaming, setTraceDreaming] = useState(false)
  const traceDreamingRef = useRef(false)
  const lastActivityRef  = useRef(Date.now())
  // Keep a stable ref to runTraceDream so the idle interval can call the latest version
  const runTraceDreamRef = useRef<() => void>(() => { /* initialized below */ })
  const [replaying, setReplaying]         = useState(false)
  const [audit, setAudit]                 = useState<AuditAttestation | null>(null)
  const [proposals, setProposals]         = useState<GraphProposal[]>([])
  const [posture, setPosture]             = useState<GovernancePosture | null>(null)
  const [pseudonym, setPseudonym]         = useState<string | null>(null)
  interface DueSkill { id?: string; task: string; abstraction: string; steps: string[]; card: { due: number; intervalDays: number; ease: number; reps: number } }
  const [dueSkills, setDueSkills]         = useState<DueSkill[]>([])
  const [grading, setGrading]             = useState<string | null>(null)
  const [bonEnabled, setBonEnabled]                     = useState(false)
  const [bonToggling, setBonToggling]                   = useState(false)
  const [uncertaintyEnabled, setUncertaintyEnabled]     = useState(false)
  const [uncertaintyToggling, setUncertaintyToggling]   = useState(false)
  const [proceduralEnabled, setProceduralEnabled]       = useState(false)
  const [proceduralToggling, setProceduralToggling]     = useState(false)
  interface DecayStats { pruned: number; lastPruneAt: number | null; budget: number }
  const [decayStats, setDecayStats]       = useState<DecayStats | null>(null)

  // SCOPE-D policy editor
  const ACTION_CLASSES = ['read','synthetic_event','dry_run','network_call','write','deployment','destructive_action','credential_access','memory_write','identity_write'] as const
  const GATE_VALUES    = ['none','single_human','human_and_policy','human_and_policy_engine','frost_quorum'] as const
  const AUTH_MODES     = ['read','write','synthetic_only'] as const
  const [showPolicyEditor, setShowPolicyEditor] = useState(false)
  const [pePolicyId,       setPePolicyId]       = useState('')
  const [peName,           setPeName]           = useState('')
  const [peTargets,        setPeTargets]        = useState('')
  const [peModes,          setPeModes]          = useState<string[]>(['read'])
  const [peRules,          setPeRules]          = useState<{ actionClass: string; requiredGate: string }[]>([{ actionClass: 'network_call', requiredGate: 'none' }])
  const [peBlocked,        setPeBlocked]        = useState<string[]>([])
  const [peExpires,        setPeExpires]        = useState('')
  const [peSaving,         setPeSaving]         = useState(false)
  const [peSaveMsg,        setPeSaveMsg]        = useState('')

  async function savePolicy() {
    setPeSaving(true); setPeSaveMsg('')
    try {
      const policy = {
        policyId: pePolicyId.trim(),
        name: peName.trim(),
        authorizedTargets: peTargets.split('\n').map((t) => t.trim()).filter(Boolean),
        authorizedModes: peModes,
        approvalRules: peRules.filter((r) => r.actionClass),
        blockedActions: peBlocked,
        ...(peExpires ? { expiresAt: new Date(peExpires).toISOString() } : {}),
      }
      const r = await fetch(amUrl('/api/governance/policy'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      })
      const d = await r.json() as { saved?: boolean; error?: string }
      if (!r.ok) throw new Error(d.error ?? `save ${r.status}`)
      setPeSaveMsg('Policy saved — restart agent-machine to activate.')
    } catch (e) { setPeSaveMsg(e instanceof Error ? e.message : 'save failed') }
    finally { setPeSaving(false) }
  }

  const runReplay = () => {
    setReplaying(true)
    // Re-run captured failures against the current system, then refresh the felt-win number.
    fetch(amUrl('/api/learning/replay'), { method: 'POST', signal: AbortSignal.timeout(120000) })
      .then(() => fetch(amUrl('/api/learning/stats'), { signal: AbortSignal.timeout(3000) }))
      .then(r => r.ok ? r.json() : null)
      .then((d: LearningStats | null) => { if (d) setLearning(d) })
      .catch(() => { /* model/retrieval unavailable — leave prior result */ })
      .finally(() => setReplaying(false))
  }
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
    // Tamper-evidence: verify the egress audit chain (hash-linked + Ed25519-signed head) for the attestation badge.
    fetch(amUrl('/api/govern/audit/verify'), { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: AuditAttestation | null) => { if (d) setAudit(d) })
      .catch(() => { /* not running — skip */ })
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
    // Trace consolidation — load status from last run (persists across restarts)
    fetch(amUrl('/api/learning/dream-status'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: TraceDreamResult | null) => { if (d) setTraceDream(d) })
      .catch(() => { /* best-effort */ })
    loadMemories()
    // Graph proposals: agent-staged changes awaiting user accept/reject
    fetch(amUrl('/api/graph/proposals'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { proposals?: GraphProposal[] } | null) => { if (d?.proposals) setProposals(d.proposals.filter((p) => p.status === 'pending')) })
      .catch(() => { /* not running — skip */ })
    // Principal hierarchy + scope-d posture
    fetch(amUrl('/api/governance/posture'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: GovernancePosture | null) => { if (d) setPosture(d) })
      .catch(() => { /* not running — skip */ })
    // Sovereign identity — device-anchored did:key pseudonym
    fetch(amUrl('/api/identity/pseudonym'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { pseudonym?: string } | null) => { if (d?.pseudonym) setPseudonym(d.pseudonym) })
      .catch(() => { /* not running — skip */ })
    // SRS — skills due for spaced-repetition practice
    fetch(amUrl('/api/learning/srs/due'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { due?: DueSkill[] } | null) => { if (d?.due) setDueSkills(d.due) })
      .catch(() => { /* not running — skip */ })
    // Runtime settings (Best-of-N toggle state)
    fetch(amUrl('/api/settings'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { bonEnabled?: boolean; uncertaintyEnabled?: boolean; proceduralEnabled?: boolean } | null) => {
        if (d) {
          if (typeof d.bonEnabled === 'boolean') setBonEnabled(d.bonEnabled)
          if (typeof d.uncertaintyEnabled === 'boolean') setUncertaintyEnabled(d.uncertaintyEnabled)
          if (typeof d.proceduralEnabled === 'boolean') setProceduralEnabled(d.proceduralEnabled)
        }
      })
      .catch(() => { /* not running — skip */ })
    // Memory decay stats
    fetch(amUrl('/api/memory/decay-stats'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: DecayStats | null) => { if (d) setDecayStats(d) })
      .catch(() => { /* not running — skip */ })
  }, [])

  async function handleProposal(id: string, action: 'accept' | 'reject') {
    try {
      await fetch(amUrl('/api/graph/proposals'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: action === 'accept' ? 'accept' : 'reject', id }),
        signal: AbortSignal.timeout(5000),
      })
      setProposals((prev) => prev.filter((p) => p.id !== id))
    } catch { /* best-effort */ }
  }

  // Trigger a consolidation pass that PERSISTS the strongest proposals (POST = integrate).
  async function runDream() {
    setDreaming(true)
    try {
      const r = await fetch(amUrl('/api/dream'), { method: 'POST', signal: AbortSignal.timeout(20000) })
      if (r.ok) setDream(await r.json() as DreamResult)
    } catch { /* skip */ } finally { setDreaming(false) }
  }

  // Trace consolidation dreaming — offline skill synthesis from recent experiences.
  // Also fires automatically via the idle timer below.
  async function runTraceDream() {
    if (traceDreamingRef.current) return
    traceDreamingRef.current = true
    setTraceDreaming(true)
    try {
      const r = await fetch(amUrl('/api/learning/dream-traces'), { method: 'POST', signal: AbortSignal.timeout(120_000) })
      if (r.ok) setTraceDream(await r.json() as TraceDreamResult)
    } catch { /* best-effort */ }
    finally { traceDreamingRef.current = false; setTraceDreaming(false) }
  }
  runTraceDreamRef.current = () => { void runTraceDream() }

  // Idle timer — auto-fires trace consolidation after 5 min of no user interaction.
  // Uses document-level listeners so it works regardless of which surface is active.
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now() }
    document.addEventListener('mousemove', bump, { passive: true })
    document.addEventListener('keydown',   bump, { passive: true })
    const timer = setInterval(() => {
      if (!traceDreamingRef.current && Date.now() - lastActivityRef.current > 5 * 60_000) {
        lastActivityRef.current = Date.now() // reset so it doesn't fire again immediately
        runTraceDreamRef.current()
      }
    }, 60_000)
    return () => {
      document.removeEventListener('mousemove', bump)
      document.removeEventListener('keydown',   bump)
      clearInterval(timer)
    }
  }, [])

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

  async function gradeSkill(id: string, grade: 0|1|2|3) {
    setGrading(id)
    try {
      await fetch(amUrl('/api/learning/srs/review'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, grade }),
      })
      setDueSkills((prev) => prev.filter((s) => (s.id ?? s.task) !== id))
    } catch { /* best-effort */ }
    finally { setGrading(null) }
  }

  async function toggleBon() {
    setBonToggling(true)
    try {
      const r = await fetch(amUrl('/api/settings'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bonEnabled: !bonEnabled }),
      })
      if (r.ok) { const d = await r.json() as { bonEnabled: boolean }; setBonEnabled(d.bonEnabled) }
    } catch { /* best-effort */ }
    finally { setBonToggling(false) }
  }

  async function toggleUncertainty() {
    setUncertaintyToggling(true)
    try {
      const r = await fetch(amUrl('/api/settings'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uncertaintyEnabled: !uncertaintyEnabled }),
      })
      if (r.ok) { const d = await r.json() as { uncertaintyEnabled: boolean }; setUncertaintyEnabled(d.uncertaintyEnabled) }
    } catch { /* best-effort */ }
    finally { setUncertaintyToggling(false) }
  }

  async function toggleProcedural() {
    setProceduralToggling(true)
    try {
      const r = await fetch(amUrl('/api/settings'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proceduralEnabled: !proceduralEnabled }),
      })
      if (r.ok) { const d = await r.json() as { proceduralEnabled: boolean }; setProceduralEnabled(d.proceduralEnabled) }
    } catch { /* best-effort */ }
    finally { setProceduralToggling(false) }
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

        {/* Tamper-evidence attestation — egress audit chain (hash-linked + Ed25519-signed head) */}
        {audit && (
          <div className="rounded-2xl border p-4 shadow-sm" style={{ borderColor: audit.attested ? '#bbf7d0' : '#fde68a', background: audit.attested ? '#f0fdf4' : '#fffbeb' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">{audit.attested ? '🛡️' : '⚠️'}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: audit.attested ? '#166534' : '#92400e' }}>
                  {audit.attested ? 'Audit chain attested' : 'Audit chain — needs attention'}
                </span>
              </div>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">{audit.entries} entries · key {audit.fingerprint.slice(0, 8)}</span>
            </div>
            <div className="mt-1.5 text-[11px] text-[var(--color-text-secondary)]">
              {audit.attested
                ? 'Every egress event is hash-linked and the head is Ed25519-signed with the device key — tamper-evident.'
                : `${audit.chainValid ? '' : `Chain link broke at entry ${audit.firstBreakAt}. `}${audit.signed ? (audit.signatureValid ? '' : 'Head signature invalid. ') : 'Head not signed. '}(Often a multi-writer dev artifact; production is single-writer.)`}
            </div>
          </div>
        )}

        {/* Principal hierarchy — which authority level governs this session */}
        {posture && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Principal hierarchy</div>
              {posture.scopedConfigured && posture.policyId && (
                <span className="rounded-full bg-[rgba(124,58,237,0.10)] px-2.5 py-0.5 text-[10px] font-semibold text-[#7c3aed]" title={posture.policyName ?? undefined}>{posture.policyId.slice(0, 28)}</span>
              )}
              {!posture.scopedConfigured && (
                <span className="rounded-full border border-[var(--color-border-tertiary)] px-2.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">No SCOPE-D policy</span>
              )}
            </div>
            <div className="space-y-2">
              {posture.authorityHierarchy.map((tier, i) => {
                const colors = TIER_COLOR[tier.level] ?? TIER_COLOR['guideline']
                return (
                  <div key={tier.level} className={`flex items-start gap-3 rounded-xl border p-3 transition ${tier.active ? 'border-[var(--color-border-secondary)]' : 'border-[var(--color-border-tertiary)] opacity-45'}`}>
                    <div className="flex shrink-0 flex-col items-center pt-0.5">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: tier.active ? colors.dot : 'var(--color-text-tertiary)' }} />
                      {i < posture.authorityHierarchy.length - 1 && <div className="mt-1 h-5 w-px bg-[var(--color-border-tertiary)]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tier.active ? colors.chip : 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'}`}>{tier.level}</span>
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">{tier.label}</span>
                        {!tier.active && <span className="text-[10px] text-[var(--color-text-tertiary)]">inactive</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{tier.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Plan-mode escalation classes */}
            <div className="mt-3 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Requires plan mode in auto</div>
              <div className="flex flex-wrap gap-1.5">
                {posture.escalationActionClasses.map((cls) => (
                  <span key={cls} className="rounded-full border border-[rgba(220,38,38,0.30)] bg-[rgba(220,38,38,0.06)] px-2 py-0.5 font-mono text-[10px] text-[#dc2626]">{cls}</span>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] text-[var(--color-text-tertiary)]">{posture.escalationNote}</div>
            </div>
          </div>
        )}

        {/* SCOPE-D engagement policy editor */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c3aed]">Engagement Policy</div>
            <button onClick={() => setShowPolicyEditor((v) => !v)}
              className="rounded-full border border-[var(--color-border-tertiary)] px-2.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] transition">
              {showPolicyEditor ? 'Hide editor' : 'Edit policy'}
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-text-tertiary)] leading-relaxed">
            SCOPE-D EngagementPolicy governs agent egress routing, action authorization, and operator approval requirements.
            {posture?.scopedConfigured ? ` Active: ${posture.policyName ?? posture.policyId ?? 'configured'}.` : ' No policy configured — agent runs without egress gating.'}
          </p>
          {showPolicyEditor && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Policy ID</span>
                  <input value={pePolicyId} onChange={(e) => setPePolicyId(e.target.value)} placeholder="my-policy" className="mt-0.5 block w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Name</span>
                  <input value={peName} onChange={(e) => setPeName(e.target.value)} placeholder="My engagement policy" className="mt-0.5 block w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
                </label>
              </div>

              <label className="block">
                <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Authorized egress targets <span className="font-normal text-[var(--color-text-tertiary)]">(one host per line; empty = unrestricted)</span></span>
                <textarea value={peTargets} onChange={(e) => setPeTargets(e.target.value)} rows={3} placeholder={'api.anthropic.com\nbackend.composio.dev'} className="mt-0.5 block w-full resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed] font-mono" />
              </label>

              <div>
                <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Authorized modes</span>
                <div className="mt-1 flex gap-3">
                  {AUTH_MODES.map((m) => (
                    <label key={m} className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={peModes.includes(m)} onChange={(e) => setPeModes((ms) => e.target.checked ? [...ms, m] : ms.filter((x) => x !== m))} className="h-3 w-3 rounded" />
                      <span className="text-[11px] text-[var(--color-text-secondary)]">{m}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Approval rules</span>
                  <button type="button" onClick={() => setPeRules((rs) => [...rs, { actionClass: 'write', requiredGate: 'single_human' }])}
                    className="text-[10px] text-[#7c3aed] hover:underline">+ Add rule</button>
                </div>
                <div className="space-y-1">
                  {peRules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <select value={rule.actionClass} onChange={(e) => setPeRules((rs) => rs.map((r, j) => j === i ? { ...r, actionClass: e.target.value } : r))}
                        className="flex-1 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[10px] text-[var(--color-text-primary)] outline-none">
                        {ACTION_CLASSES.map((ac) => <option key={ac} value={ac}>{ac}</option>)}
                      </select>
                      <select value={rule.requiredGate} onChange={(e) => setPeRules((rs) => rs.map((r, j) => j === i ? { ...r, requiredGate: e.target.value } : r))}
                        className="flex-1 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[10px] text-[var(--color-text-primary)] outline-none">
                        {GATE_VALUES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                      {peRules.length > 1 && <button type="button" onClick={() => setPeRules((rs) => rs.filter((_, j) => j !== i))} className="text-[var(--color-text-tertiary)] hover:text-[#dc2626] px-1 text-xs">×</button>}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Blocked actions</span>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {ACTION_CLASSES.map((ac) => (
                    <label key={ac} className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={peBlocked.includes(ac)} onChange={(e) => setPeBlocked((bs) => e.target.checked ? [...bs, ac] : bs.filter((x) => x !== ac))} className="h-3 w-3 rounded" />
                      <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">{ac}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">Expires at <span className="font-normal text-[var(--color-text-tertiary)]">(leave blank = never)</span></span>
                <input type="datetime-local" value={peExpires} onChange={(e) => setPeExpires(e.target.value)} className="mt-0.5 block rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[#7c3aed]" />
              </label>

              {peSaveMsg && (
                <div className={`rounded-lg px-3 py-2 text-[11px] ${peSaveMsg.includes('saved') ? 'border border-[#16a34a]/40 bg-[#16a34a]/5 text-[#16a34a]' : 'border border-[#fecaca] bg-[#fef2f2] text-[#dc2626]'}`}>{peSaveMsg}</div>
              )}
              <button type="button" onClick={() => void savePolicy()} disabled={peSaving || !pePolicyId.trim() || !peName.trim()}
                className="rounded-xl bg-[#7c3aed] px-4 py-2 text-[11px] font-semibold text-white transition hover:bg-[#6d28d9] disabled:opacity-50">
                {peSaving ? 'Saving…' : 'Save policy to disk'}
              </button>
              <p className="text-[10px] text-[var(--color-text-tertiary)]">Requires <code className="font-mono">SCOPED_ENGAGEMENT_POLICY</code> env var pointing to a writable JSON path. Restart agent-machine after saving.</p>
            </div>
          )}
        </div>

        {/* Production-learning loop — what the agent has learned from real turns */}
        {learning && (learning.skills.count > 0 || learning.evalCases.count > 0 || (learning.experiences?.count ?? 0) > 0) && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Learning loop</div>
              {learning.evalCases.count > 0 && (
                <button onClick={runReplay} disabled={replaying}
                  className="rounded-full border border-[var(--color-border-tertiary)] px-2.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] disabled:opacity-50">
                  {replaying ? 'Re-checking…' : 'Re-check failures'}
                </button>
              )}
            </div>
            {/* The felt win: how many of your real captured failures the system now passes. */}
            {learning.replay && learning.replay.total > 0 && (
              <div className="mb-3 rounded-xl border border-[#16a34a]/40 bg-[#16a34a]/5 p-3 text-center">
                <div className="text-2xl font-semibold text-[#16a34a]">{learning.replay.fixed}/{learning.replay.total} fixed</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">of your captured failures now pass ({Math.round(learning.replay.fixedRate * 100)}%)</div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-2xl font-semibold text-[#16a34a]">{learning.skills.count}</span>
                  {learning.skills.due > 0 && (
                    <span className="rounded-full bg-[#1d4ed8] px-1.5 text-[9px] font-semibold text-white">{learning.skills.due}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Skills{learning.skills.due > 0 ? ` · ${learning.skills.due} due` : ''}</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[#7c3aed]">{learning.experiences?.count ?? 0}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Experiences</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-2xl font-semibold text-[#d97706]">{learning.evalCases.count}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Failures</div>
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

        {/* Graph proposals — agent-staged changes the user must approve before they mutate the graph */}
        {proposals.length > 0 && (
          <div className="rounded-2xl border border-[#fef08a] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b45309]">Graph proposals</div>
              <span className="rounded-full bg-[#fef08a] px-2 py-0.5 text-[10px] font-semibold text-[#92400e]">{proposals.length} pending</span>
            </div>
            <ul className="space-y-2">
              {proposals.map((p) => (
                <li key={p.id} className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-full border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#92400e]">{p.op}</span>
                    {p.source && <span className="text-[10px] text-[var(--color-text-tertiary)]">from {p.source}</span>}
                  </div>
                  <div className="mb-1 text-[11px] text-[var(--color-text-primary)]">
                    {p.op === 'add-edge' ? `${String(p.payload['from'])} → ${String(p.payload['rel'])} → ${String(p.payload['to'])}` :
                     p.op === 'add-node' ? String(p.payload['node']) :
                     p.op === 'remove-edge' ? `Remove: ${String(p.payload['from'])} → ${String(p.payload['to'])}` :
                     `${String(p.payload['node'])}.${String(p.payload['prop'])} = ${String(p.payload['value'])}`}
                  </div>
                  {p.rationale && <div className="mb-2 text-[10px] italic text-[var(--color-text-tertiary)]">{p.rationale}</div>}
                  <div className="flex gap-2">
                    <button onClick={() => void handleProposal(p.id, 'reject')}
                      className="rounded-md border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)] transition">
                      Reject
                    </button>
                    <button onClick={() => void handleProposal(p.id, 'accept')}
                      className="rounded-md bg-[#16a34a] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#15803d] transition">
                      Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
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

        {/* Trace consolidation — idle pass that synthesizes skills from recent experiences */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c3aed]">Trace Consolidation</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
                Synthesizes reusable skills from recent agent experiences.
                {traceDream?.lastRun
                  ? ` Last run ${traceDreamAgo(traceDream.lastRun)}.`
                  : ' Fires automatically after 5 min idle, or trigger manually.'}
              </div>
            </div>
            <button onClick={() => void runTraceDream()} disabled={traceDreaming}
              className="shrink-0 rounded-lg border border-[#ddd6fe] bg-[#f5f3ff] px-2.5 py-1 text-[10px] font-semibold text-[#6d28d9] transition hover:bg-[#ede9fe] disabled:opacity-50">
              {traceDreaming ? 'Consolidating…' : '✦ Consolidate'}
            </button>
          </div>

          {traceDream && traceDream.extracted > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-[#7c3aed]">{traceDream.extracted}</span>
                <span className="text-[11px] text-[var(--color-text-tertiary)]">skill{traceDream.extracted !== 1 ? 's' : ''} extracted</span>
              </div>
              {traceDream.skills && traceDream.skills.length > 0 && (
                <ul className="space-y-1.5">
                  {traceDream.skills.slice(0, 3).map((s, i) => (
                    <li key={i} className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2">
                      <div className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0 text-[#7c3aed] text-[10px]">◎</span>
                        <span className="text-[11px] text-[var(--color-text-secondary)]">{s.abstraction}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)] truncate">{s.task}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {(!traceDream || traceDream.extracted === 0) && !traceDreaming && (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              No experiences distilled yet — skills accumulate as you run more agent turns with <code className="font-mono">PROCEDURAL_MEMORY=true</code>.
            </div>
          )}
          {traceDreaming && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-border-tertiary)] border-t-[#7c3aed]" />
              Synthesizing skills from experiences…
            </div>
          )}
        </div>

        {/* Sovereign identity — device-anchored did:key pseudonym */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#0891b2]">Sovereign Identity</div>
          <div className="text-[10px] text-[var(--color-text-tertiary)] mb-3 leading-relaxed">
            Device-anchored identity. No account, no server. Derived from a local root key that never leaves this machine.
          </div>
          {pseudonym ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#0891b2]" />
              <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-[var(--color-text-primary)]" title={pseudonym}>{pseudonym}</span>
              <span className="shrink-0 rounded-full bg-[rgba(8,145,178,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#0891b2]">did:key</span>
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">Agent machine not running — pseudonym unavailable.</div>
          )}
        </div>

        {/* SRS — skills due for spaced-repetition review */}
        {dueSkills.length > 0 && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#16a34a]">Skills due for review</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">{dueSkills.length} skill{dueSkills.length !== 1 ? 's' : ''} scheduled for spaced-repetition practice</div>
              </div>
            </div>
            <div className="space-y-2">
              {dueSkills.map((s) => {
                const skillId = s.id ?? s.task
                const isGrading = grading === skillId
                return (
                  <div key={skillId} className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2.5">
                    <div className="mb-1.5 flex items-start gap-1.5">
                      <span className="mt-0.5 shrink-0 text-[10px] text-[#16a34a]">◎</span>
                      <span className="text-[12px] font-medium text-[var(--color-text-primary)]">{s.abstraction}</span>
                    </div>
                    <div className="mb-2 truncate text-[10px] text-[var(--color-text-tertiary)]">{s.task}</div>
                    <div className="flex gap-1.5">
                      {(['Again', 'Hard', 'Good', 'Easy'] as const).map((label, grade) => (
                        <button
                          key={label}
                          disabled={isGrading}
                          onClick={() => void gradeSkill(skillId, grade as 0|1|2|3)}
                          className="flex-1 rounded-lg border border-[var(--color-border-secondary)] py-1 text-[10px] font-semibold transition hover:bg-[var(--color-background-primary)] disabled:opacity-40"
                          style={{ color: grade === 0 ? '#dc2626' : grade === 1 ? '#d97706' : grade === 2 ? '#16a34a' : '#0891b2' }}
                        >
                          {isGrading ? '…' : label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Best-of-N runtime toggle */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Best-of-N selection</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
                Samples N=3 candidates for low-confidence turns and picks the strongest grounded response.
              </div>
            </div>
            <button
              onClick={() => void toggleBon()}
              disabled={bonToggling}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${bonEnabled ? 'bg-[#1d4ed8] text-white hover:bg-[#1e40af]' : 'border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:border-[#1d4ed8] hover:text-[#1d4ed8]'}`}
            >
              {bonToggling ? '…' : bonEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)]">
            {bonEnabled ? 'Active — low-confidence turns will sample 3 completions and select the best.' : 'Off — single-sample path. Enable to improve response quality on ambiguous prompts.'}
          </div>
        </div>

        {/* Uncertainty gate runtime toggle */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0891b2]">Uncertainty gate</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
                Appends a calibrated low-confidence disclaimer when semantic entropy indicates the model is guessing.
              </div>
            </div>
            <button
              onClick={() => void toggleUncertainty()}
              disabled={uncertaintyToggling}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${uncertaintyEnabled ? 'bg-[#0891b2] text-white hover:bg-[#0e7490]' : 'border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:border-[#0891b2] hover:text-[#0891b2]'}`}
            >
              {uncertaintyToggling ? '…' : uncertaintyEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)]">
            {uncertaintyEnabled ? 'Active — responses with high semantic entropy will carry a hedge or abstention notice.' : 'Off — no abstention overlay. Enable to surface genuine knowledge gaps rather than confident hallucinations.'}
          </div>
        </div>

        {/* Procedural memory (loop 2+3) runtime toggle */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#16a34a]">Procedural memory</div>
              <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
                Distills successful turns into reusable skills (loop 2) and enrolls them in spaced-repetition review (loop 3).
              </div>
            </div>
            <button
              onClick={() => void toggleProcedural()}
              disabled={proceduralToggling}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${proceduralEnabled ? 'bg-[#16a34a] text-white hover:bg-[#15803d]' : 'border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:border-[#16a34a] hover:text-[#16a34a]'}`}
            >
              {proceduralToggling ? '…' : proceduralEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)]">
            {proceduralEnabled
              ? 'Active — high-quality turns are being distilled into the skill library and scheduled for SRS review.'
              : 'Off — only eval-capture (failures) is running. Enable to start compounding the skill library.'}
          </div>
        </div>

        {/* Memory decay health */}
        {decayStats && (
          <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#0891b2]">Memory health</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-xl font-semibold text-[var(--color-text-primary)]">{decayStats.budget}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Budget</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className={`text-xl font-semibold ${decayStats.pruned > 0 ? 'text-[#d97706]' : 'text-[#16a34a]'}`}>{decayStats.pruned}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Pruned</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-3 text-center">
                <div className="text-xl font-semibold text-[var(--color-text-primary)]">{decayStats.lastPruneAt ? new Date(decayStats.lastPruneAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">Last prune</div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
              {decayStats.pruned === 0 ? 'Memory store is within budget — no evictions yet.' : `${decayStats.pruned} low-salience memories evicted to stay within the ${decayStats.budget}-memory budget.`}
            </div>
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

        {/* Autonomy — governed AI-driven-development ladder */}
        <AutonomyPanel />

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

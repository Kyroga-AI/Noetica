'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { amUrl } from '@/lib/tauri/bridge'

// ─── Types (mirrors agent-machine/lib/gaia.ts) ────────────────────────────────

interface TwinState {
  twin_id: string
  subject_id: string
  last_observation_at: string | null
  last_belief_at: string | null
  last_cycle_at: string | null
  policy_status: 'active' | 'restricted' | 'revoked'
  observation_count: number
  law_count: number
}

interface PosteriorAtom  { claim: string; weight: number }
interface WeightedRule   { pattern: string; support: number }
interface Hypothesis     { hypothesis: string; evidence: string[] }

interface BeliefSnapshot {
  id: string
  created_at: string
  current_focus: string
  focus_confidence: number
  posterior_atoms: PosteriorAtom[]
  weighted_rules: WeightedRule[]
  hypotheses: Hypothesis[]
  world_summary: string
}

interface CandidateLaw {
  id: string
  props: { law: string; trigger: string; confidence: number; created_at: string }
}

interface WorldSnapshot {
  id: string
  props: { captured_at: string; summary: string }
}

interface LoopStatus {
  enabled: boolean
  running: boolean
  last_loop_at: string | null
  interval_ms: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const color = pct > 70 ? '#22c55e' : pct > 40 ? '#f59e0b' : '#94a3b8'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-[var(--color-background-tertiary)] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{pct}%</span>
    </div>
  )
}

// ─── Surface ──────────────────────────────────────────────────────────────────

export function HolographMeSurface() {
  const { settings } = useSettings()

  const [twinState, setTwinState]     = useState<TwinState | null>(null)
  const [beliefs, setBeliefs]         = useState<BeliefSnapshot[]>([])
  const [laws, setLaws]               = useState<CandidateLaw[]>([])
  const [worldStates, setWorldStates] = useState<WorldSnapshot[]>([])
  const [loopStatus, setLoopStatus]   = useState<LoopStatus | null>(null)
  const [loading, setLoading]         = useState(true)
  const [triggering, setTriggering]   = useState(false)
  const [selectedBelief, setSelectedBelief] = useState<BeliefSnapshot | null>(null)
  const [tab, setTab] = useState<'overview' | 'beliefs' | 'laws' | 'world'>('overview')

  const fetchAll = useCallback(async () => {
    try {
      const [twinRes, beliefsRes, lawsRes, worldRes, loopRes] = await Promise.all([
        fetch(amUrl('/api/gaia/twin'),           { signal: AbortSignal.timeout(5000) }),
        fetch(amUrl('/api/gaia/beliefs?limit=5'),{ signal: AbortSignal.timeout(5000) }),
        fetch(amUrl('/api/gaia/laws?limit=15'),  { signal: AbortSignal.timeout(5000) }),
        fetch(amUrl('/api/gaia/world?limit=8'),  { signal: AbortSignal.timeout(5000) }),
        fetch(amUrl('/api/gaia/loop/status'),    { signal: AbortSignal.timeout(5000) }),
      ])
      if (twinRes.ok)    setTwinState(await twinRes.json() as TwinState)
      if (beliefsRes.ok) { const d = await beliefsRes.json() as { beliefs: BeliefSnapshot[] }; setBeliefs(d.beliefs); if (d.beliefs[0] && !selectedBelief) setSelectedBelief(d.beliefs[0]) }
      if (lawsRes.ok)    { const d = await lawsRes.json() as { laws: CandidateLaw[] }; setLaws(d.laws) }
      if (worldRes.ok)   { const d = await worldRes.json() as { snapshots: WorldSnapshot[] }; setWorldStates(d.snapshots) }
      if (loopRes.ok)    setLoopStatus(await loopRes.json() as LoopStatus)
    } catch { /* agent-machine may not be running */ }
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchAll() }, [fetchAll])
  // Poll every 30s if loop is enabled
  useEffect(() => {
    if (!loopStatus?.enabled) return
    const t = setInterval(() => void fetchAll(), 30000)
    return () => clearInterval(t)
  }, [loopStatus?.enabled, fetchAll])

  async function triggerLoop() {
    if (triggering) return
    const key = settings.anthropicApiKey || settings.openaiApiKey
    if (!key) return
    setTriggering(true)
    try {
      await fetch(amUrl('/api/gaia/loop/trigger'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ anthropic_key: settings.anthropicApiKey || undefined, openai_key: settings.openaiApiKey || undefined }),
        signal: AbortSignal.timeout(10000),
      })
      setTimeout(() => { void fetchAll() }, 3000)
    } catch { /* ignore */ }
    setTriggering(false)
  }

  async function startLoop() {
    const key = settings.anthropicApiKey || settings.openaiApiKey
    if (!key) return
    try {
      await fetch(amUrl('/api/gaia/loop/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ anthropic_key: settings.anthropicApiKey || undefined, openai_key: settings.openaiApiKey || undefined }),
        signal: AbortSignal.timeout(10000),
      })
      void fetchAll()
    } catch { /* ignore */ }
  }

  const latestBelief = beliefs[0] ?? null
  const hasKeys = !!(settings.anthropicApiKey || settings.openaiApiKey)

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-text-tertiary)]">
        Loading twin state…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

      {/* Header */}
      <div className="border-b border-[var(--color-border-secondary)] px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              M
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-[var(--color-text-primary)]">Michael Heller</h1>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  twinState?.policy_status === 'active' ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fef2f2] text-[#dc2626]'
                }`}>
                  {twinState?.policy_status ?? 'unknown'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">michael@socioprophet.ai · Human Digital Twin</div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
                <span>{twinState?.observation_count ?? 0} observations</span>
                <span>·</span>
                <span>{twinState?.law_count ?? 0} candidate laws</span>
                <span>·</span>
                <span>last cycle {timeAgo(twinState?.last_cycle_at ?? null)}</span>
              </div>
            </div>
          </div>

          {/* Loop controls */}
          <div className="flex items-center gap-2">
            {loopStatus && (
              <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${loopStatus.running ? 'bg-[#22c55e] animate-pulse' : loopStatus.enabled ? 'bg-[#22c55e]' : 'bg-[#94a3b8]'}`} />
                <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                  {loopStatus.running ? 'Synthesising…' : loopStatus.enabled ? `Loop active · ${loopStatus.interval_ms / 60000}m` : 'Loop off'}
                </span>
              </div>
            )}
            {hasKeys && !loopStatus?.enabled && (
              <button
                onClick={() => void startLoop()}
                className="rounded-xl bg-[#6366f1] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4f46e5]"
              >
                Start loop
              </button>
            )}
            <button
              onClick={() => void triggerLoop()}
              disabled={triggering || !hasKeys}
              className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#6366f1] hover:text-[#6366f1] disabled:opacity-50"
            >
              {triggering ? 'Running…' : 'Run now'}
            </button>
            <button
              onClick={() => void fetchAll()}
              className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-primary)]"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-1 w-fit">
          {(['overview', 'beliefs', 'laws', 'world'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition ${tab === t ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="mx-auto max-w-2xl space-y-5">

            {/* Current focus */}
            {latestBelief ? (
              <div className="rounded-2xl border border-[#e0e7ff] bg-[#f5f3ff] p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6366f1]">Current focus</span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(latestBelief.created_at)}</span>
                </div>
                <p className="text-sm font-medium text-[var(--color-text-primary)] leading-6">{latestBelief.current_focus}</p>
                <div className="mt-3">
                  <ConfidenceBar value={latestBelief.focus_confidence} />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] p-8 text-center">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">No belief state yet</p>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {hasKeys ? 'Click "Run now" to synthesise your first belief snapshot from computer-use sessions.' : 'Add an API key in Settings to enable the superconscious loop.'}
                </p>
              </div>
            )}

            {/* World summary */}
            {latestBelief?.world_summary && (
              <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] mb-2">World state</div>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{latestBelief.world_summary}</p>
              </div>
            )}

            {/* Top beliefs */}
            {latestBelief && latestBelief.posterior_atoms.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] mb-3">Belief atoms</div>
                <div className="space-y-2.5">
                  {latestBelief.posterior_atoms.slice(0, 5).map((atom, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-[10px] font-mono text-[var(--color-text-tertiary)]">{String(Math.round(atom.weight * 100)).padStart(2, ' ')}%</span>
                        <p className="text-xs text-[var(--color-text-primary)]">{atom.claim}</p>
                      </div>
                      <div className="ml-8">
                        <ConfidenceBar value={atom.weight} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top candidate laws */}
            {laws.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] mb-3">Candidate laws</div>
                <div className="space-y-3">
                  {laws.slice(0, 4).map((law) => (
                    <div key={law.id} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
                      <p className="text-xs font-medium text-[var(--color-text-primary)]">{law.props.law}</p>
                      <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Trigger: {law.props.trigger}</p>
                      <div className="mt-2">
                        <ConfidenceBar value={law.props.confidence} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Beliefs ── */}
        {tab === 'beliefs' && (
          <div className="mx-auto max-w-2xl space-y-4">
            {beliefs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] p-8 text-center text-sm text-[var(--color-text-tertiary)]">No belief snapshots yet.</div>
            ) : beliefs.map((b) => (
              <div
                key={b.id}
                onClick={() => setSelectedBelief(selectedBelief?.id === b.id ? null : b)}
                className={`cursor-pointer rounded-2xl border p-5 transition ${selectedBelief?.id === b.id ? 'border-[#6366f1] bg-[#f5f3ff]' : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] hover:border-[#c7d2fe]'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{b.current_focus}</p>
                  <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(b.created_at)}</span>
                </div>
                <div className="mt-2">
                  <ConfidenceBar value={b.focus_confidence} />
                </div>
                {selectedBelief?.id === b.id && (
                  <div className="mt-4 space-y-4">
                    {b.world_summary && (
                      <p className="text-xs leading-5 text-[var(--color-text-secondary)] border-t border-[#e0e7ff] pt-3">{b.world_summary}</p>
                    )}
                    {b.posterior_atoms.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6366f1] mb-2">Posterior atoms</div>
                        <div className="space-y-1.5">
                          {b.posterior_atoms.map((a, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="shrink-0 text-[10px] font-mono text-[var(--color-text-tertiary)]">{Math.round(a.weight * 100)}%</span>
                              <p className="text-xs text-[var(--color-text-primary)]">{a.claim}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {b.weighted_rules.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6366f1] mb-2">Weighted rules</div>
                        <div className="space-y-1">
                          {b.weighted_rules.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="shrink-0 text-[10px] font-mono text-[var(--color-text-tertiary)]">{Math.round(r.support * 100)}%</span>
                              <p className="text-xs text-[var(--color-text-secondary)]">{r.pattern}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {b.hypotheses.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6366f1] mb-2">Hypotheses</div>
                        <div className="space-y-1.5">
                          {b.hypotheses.map((h, i) => (
                            <div key={i} className="rounded-lg bg-[#ede9fe] px-3 py-2">
                              <p className="text-xs font-medium text-[#4c1d95]">{h.hypothesis}</p>
                              {h.evidence.length > 0 && <p className="mt-0.5 text-[10px] text-[#6d28d9]">Evidence: {h.evidence.join(', ')}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Laws ── */}
        {tab === 'laws' && (
          <div className="mx-auto max-w-2xl space-y-3">
            {laws.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] p-8 text-center text-sm text-[var(--color-text-tertiary)]">No candidate laws discovered yet. More computer-use sessions will help.</div>
            ) : laws.map((law) => (
              <div key={law.id} className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{law.props.law}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Trigger: {law.props.trigger}</p>
                    <div className="mt-2">
                      <ConfidenceBar value={law.props.confidence} />
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(law.props.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── World ── */}
        {tab === 'world' && (
          <div className="mx-auto max-w-2xl space-y-3">
            {worldStates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] p-8 text-center text-sm text-[var(--color-text-tertiary)]">No world snapshots yet.</div>
            ) : worldStates.map((ws) => (
              <div key={ws.id} className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Snapshot</span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(ws.props.captured_at)}</span>
                </div>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{ws.props.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

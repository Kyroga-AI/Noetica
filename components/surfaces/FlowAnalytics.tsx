'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'

// Shape returned by GET /api/analytics/flow (agent-machine dialogue-tracker).
interface FlowMetrics {
  turns: number
  sessions: number
  intent_distribution: Record<string, number>
  transition_matrix: Record<string, Record<string, number>>
  fallback_rate: number
  grounding_rate: number
  clarify_rate: number
  escalation_rate: number
  slot_fill_rate: number
  entity_coverage: number
  avg_latency_ms_by_intent: Record<string, number>
  top_paths: { path: string; count: number }[]
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? 'var(--color-accent-primary,var(--color-accent))' : tone === 'warn' ? 'var(--color-attention)' : 'var(--color-text-primary)'
  return (
    <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-3">
      <div className="text-[11px] text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-1 text-lg font-semibold" style={{ color }}>{value}</div>
    </div>
  )
}

/** Conversation analytics dashboard — intent flow, fallback/grounding/slot-fill
 *  rates, latency-by-intent and the common conversation paths. Reads the live
 *  dialogue-tracker metrics; the Rasa-X view of how conversations actually move. */
interface FittedPolicy {
  formula: string | null
  r2?: number
  n: number
  top_drivers?: { feature: string; weight: number }[]
}

export function FlowAnalytics() {
  const { settings } = useSettings()
  const endpoint = settings.agentMachineEndpoint || 'http://127.0.0.1:8080'
  const [m, setM] = useState<FlowMetrics | null>(null)
  const [policy, setPolicy] = useState<FittedPolicy | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${endpoint}/api/analytics/flow`, { signal: AbortSignal.timeout(5000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setM(await r.json() as FlowMetrics); setErr(null)
      const pr = await fetch(`${endpoint}/api/analytics/policy`, { signal: AbortSignal.timeout(5000) })
      if (pr.ok) setPolicy(await pr.json() as FittedPolicy)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }, [endpoint])

  useEffect(() => { void load(); const id = setInterval(() => void load(), 8000); return () => clearInterval(id) }, [load])

  if (err) return <div className="rounded-xl border border-[var(--color-border-tertiary)] p-4 text-sm text-[var(--color-text-secondary)]">No analytics yet — {err}. Have a few conversations, then refresh.</div>
  if (!m) return <div className="p-4 text-sm text-[var(--color-text-tertiary)]">Loading flow analytics…</div>
  if (m.turns === 0) return <div className="rounded-xl border border-[var(--color-border-tertiary)] p-4 text-sm text-[var(--color-text-secondary)]">No turns recorded yet. Chat a bit and the conversation flow will appear here.</div>

  const maxIntent = Math.max(...Object.values(m.intent_distribution), 1)
  const intents = Object.entries(m.intent_distribution).sort((a, b) => b[1] - a[1])
  const transitions = Object.entries(m.transition_matrix)
    .flatMap(([from, tos]) => Object.entries(tos).map(([to, n]) => ({ from, to, n })))
    .sort((a, b) => b.n - a.n).slice(0, 10)
  const latencies = Object.entries(m.avg_latency_ms_by_intent).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-4">
      {/* Learned reward policy (the interpretable symbolic fit the bandit optimizes) */}
      {policy?.formula && (
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-accent)]">Learned reward policy</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">R²={policy.r2} · n={policy.n}</span>
          </div>
          <code className="block rounded-lg bg-[var(--color-background-tertiary)] px-3 py-2 text-xs text-[var(--color-text-primary)]">{policy.formula}</code>
          {policy.top_drivers && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {policy.top_drivers.map((d) => (
                <span key={d.feature} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--color-background-tertiary)', color: d.weight >= 0 ? 'var(--color-accent-primary,var(--color-accent))' : 'var(--color-attention)' }}>
                  {d.feature} {d.weight >= 0 ? '+' : ''}{d.weight}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Headline rates */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        <Stat label="Turns" value={String(m.turns)} />
        <Stat label="Grounding" value={`${Math.round(m.grounding_rate * 100)}%`} tone="good" />
        <Stat label="Slot fill" value={`${Math.round(m.slot_fill_rate * 100)}%`} tone={m.slot_fill_rate < 0.6 ? 'warn' : 'good'} />
        <Stat label="Clarify" value={`${Math.round(m.clarify_rate * 100)}%`} tone={m.clarify_rate > 0.3 ? 'warn' : undefined} />
        <Stat label="Escalate" value={`${Math.round(m.escalation_rate * 100)}%`} tone={m.escalation_rate > 0.3 ? 'warn' : undefined} />
        <Stat label="Fallback" value={`${Math.round(m.fallback_rate * 100)}%`} tone={m.fallback_rate > 0.3 ? 'warn' : undefined} />
        <Stat label="Sessions" value={String(m.sessions)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Intent distribution */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-4">
          <div className="mb-3 text-xs font-semibold text-[#1d4ed8]">Intent distribution</div>
          <div className="space-y-1.5">
            {intents.map(([name, n]) => (
              <div key={name} className="flex items-center gap-2 text-xs">
                <div className="w-36 shrink-0 truncate text-[var(--color-text-secondary)]">{name.replace(/_/g, ' ')}</div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--color-background-tertiary)]">
                  <div className="h-full rounded bg-[#1d4ed8]" style={{ width: `${(n / maxIntent) * 100}%` }} />
                </div>
                <div className="w-6 text-right tabular-nums text-[var(--color-text-tertiary)]">{n}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top transitions (the conversation flow) */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-4">
          <div className="mb-3 text-xs font-semibold text-[#7c3aed]">Conversation flow (top transitions)</div>
          {transitions.length === 0 ? (
            <div className="text-xs text-[var(--color-text-tertiary)]">Need ≥2 turns in a session to chart transitions.</div>
          ) : (
            <div className="space-y-1.5">
              {transitions.map((t) => (
                <div key={`${t.from}→${t.to}`} className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--color-text-secondary)]">{t.from.replace(/_/g, ' ')}</span>
                  <span className="text-[var(--color-text-tertiary)]">→</span>
                  <span className="text-[var(--color-text-secondary)]">{t.to.replace(/_/g, ' ')}</span>
                  <span className="ml-auto rounded bg-[var(--color-background-tertiary)] px-1.5 tabular-nums text-[var(--color-text-tertiary)]">×{t.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Latency by intent */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-4">
          <div className="mb-3 text-xs font-semibold text-[#1d4ed8]">Avg latency by intent</div>
          <div className="space-y-1.5">
            {latencies.map(([name, ms]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary)]">{name.replace(/_/g, ' ')}</span>
                <span className="tabular-nums text-[var(--color-text-tertiary)]">{(ms / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </div>

        {/* Common paths */}
        <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-4">
          <div className="mb-3 text-xs font-semibold text-[#7c3aed]">Common paths</div>
          {m.top_paths.length === 0 ? (
            <div className="text-xs text-[var(--color-text-tertiary)]">Need ≥3 turns in a session.</div>
          ) : (
            <div className="space-y-1.5">
              {m.top_paths.map((p) => (
                <div key={p.path} className="flex items-center justify-between text-xs">
                  <span className="truncate text-[var(--color-text-secondary)]">{p.path.replace(/_/g, ' ')}</span>
                  <span className="ml-2 shrink-0 tabular-nums text-[var(--color-text-tertiary)]">×{p.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

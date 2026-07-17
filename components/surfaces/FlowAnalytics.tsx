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

interface FittedPolicy {
  formula: string | null
  r2?: number
  n: number
  top_drivers?: { feature: string; weight: number }[]
}

/** Conversation analytics dashboard — intent flow, fallback/grounding/slot-fill
 *  rates, latency-by-intent and the common conversation paths. Reads the live
 *  dialogue-tracker metrics; the Rasa-X view of how conversations actually move. */
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

  if (err) return (
    <div style={{ borderRadius: '14px', border: '1px solid var(--line)', padding: '16px', fontSize: '13px', color: 'var(--ink2)' }}>
      No analytics yet — {err}. Have a few conversations, then refresh.
    </div>
  )
  if (!m) return <div style={{ padding: '16px', fontSize: '13px', color: 'var(--ink3)' }}>Loading flow analytics&hellip;</div>
  if (m.turns === 0) return (
    <div style={{ borderRadius: '14px', border: '1px solid var(--line)', padding: '16px', fontSize: '13px', color: 'var(--ink2)' }}>
      No turns recorded yet. Chat a bit and the conversation flow will appear here.
    </div>
  )

  const transitions = Object.entries(m.transition_matrix)
    .flatMap(([from, tos]) => Object.entries(tos).map(([to, n]) => ({ from, to, n })))
    .sort((a, b) => b.n - a.n).slice(0, 10)
  const totalTransitions = transitions.reduce((sum, t) => sum + t.n, 0) || 1

  // Build the 5 headline metric cards matching the spec
  const headlineMetrics: { label: string; value: string; sub: string; color: string }[] = [
    {
      label: 'Fallback rate',
      value: `${Math.round(m.fallback_rate * 100)}%`,
      sub: 'sessions falling back to weaker model',
      color: m.fallback_rate > 0.3 ? '#d97706' : 'var(--ink)',
    },
    {
      label: 'Grounding rate',
      value: `${Math.round(m.grounding_rate * 100)}%`,
      sub: 'turns grounded in retrieved context',
      color: 'var(--verified-fg)',
    },
    {
      label: 'Avg turns',
      value: m.sessions > 0 ? (m.turns / m.sessions).toFixed(1) : String(m.turns),
      sub: `across ${m.sessions} sessions`,
      color: 'var(--ink)',
    },
    {
      label: 'Slot fill',
      value: `${Math.round(m.slot_fill_rate * 100)}%`,
      sub: 'entity slots filled on first ask',
      color: m.slot_fill_rate < 0.6 ? '#d97706' : 'var(--verified-fg)',
    },
    {
      label: 'Sessions',
      value: String(m.sessions),
      sub: `${m.turns} total turns`,
      color: 'var(--ink)',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Intro description */}
      <div style={{ fontSize: '12px', color: 'var(--ink2)', lineHeight: 1.6 }}>
        Conversational-flow health from the local Agent Machine. Shows how often sessions fall back
        to a weaker model, how many turns are grounded in retrieved context, and how intents
        transition across a conversation.
      </div>

      {/* Learned reward policy */}
      {policy?.formula && (
        <div style={{
          background: 'var(--paper-sunk)',
          borderRadius: '14px',
          padding: '18px',
          border: '1px solid var(--line)',
        }}>
          <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--verified-fg)', textTransform: 'uppercase' }}>Learned reward policy</span>
            <span style={{ fontSize: '10px', color: 'var(--ink3)' }}>R²={policy.r2} · n={policy.n}</span>
          </div>
          <code style={{
            display: 'block',
            borderRadius: '10px',
            background: 'var(--paper-sunk-2)',
            padding: '8px 12px',
            fontSize: '12px',
            color: 'var(--ink)',
          }}>
            {policy.formula}
          </code>
          {policy.top_drivers && (
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {policy.top_drivers.map((d) => (
                <span key={d.feature} style={{
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  background: 'var(--paper-sunk-2)',
                  color: d.weight >= 0 ? 'var(--verified-fg)' : '#d97706',
                }}>
                  {d.feature} {d.weight >= 0 ? '+' : ''}{d.weight}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5 headline rate cards */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        {headlineMetrics.map((fm) => (
          <div key={fm.label} style={{
            flex: 1,
            minWidth: '140px',
            background: 'var(--paper-sunk)',
            borderRadius: '14px',
            padding: '18px',
            border: '1px solid var(--line)',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--ink2)', textTransform: 'uppercase', marginBottom: '8px' }}>
              {fm.label}
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: fm.color }}>
              {fm.value}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--ink3)', marginTop: '4px' }}>
              {fm.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Intent transitions */}
      <div style={{
        background: 'var(--paper-sunk)',
        borderRadius: '14px',
        padding: '18px',
        border: '1px solid var(--line)',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--ink2)', textTransform: 'uppercase', marginBottom: '10px' }}>
          Intent transitions
        </div>
        {transitions.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--ink3)' }}>Need at least 2 turns in a session to chart transitions.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {transitions.map((t) => {
              const pct = `${Math.round((t.n / totalTransitions) * 100)}%`
              return (
                <div key={`${t.from}-${t.to}`} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12.5px', color: 'var(--ink)', width: '120px', flexShrink: 0 }}>
                    {t.from.replace(/_/g, ' ')}
                  </span>
                  {/* CSS border-triangle arrow */}
                  <div style={{
                    width: 0,
                    height: 0,
                    borderTop: '4px solid transparent',
                    borderBottom: '4px solid transparent',
                    borderLeft: '6px solid var(--ink3)',
                  }} />
                  <span style={{ fontSize: '12.5px', color: 'var(--ink)', width: '120px' }}>
                    {t.to.replace(/_/g, ' ')}
                  </span>
                  <div style={{
                    height: '5px',
                    flex: 1,
                    borderRadius: '999px',
                    background: 'var(--paper-sunk-2)',
                    overflow: 'hidden',
                    maxWidth: '140px',
                  }}>
                    <div style={{
                      height: '100%',
                      width: pct,
                      background: 'var(--violet)',
                      borderRadius: '999px',
                    }} />
                  </div>
                  <span className="font-mono" style={{ fontSize: '11px', color: 'var(--ink2)', width: '34px', textAlign: 'right' }}>
                    {pct}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

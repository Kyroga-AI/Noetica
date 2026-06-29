'use client'

/**
 * AutonomyPanel — the operator surface for the AI-driven-development autonomy ladder.
 * Reads /api/autonomy (agent-machine) for the bound session + canonical ladder, lets the operator
 * bind/clear an autonomy level for a role with the evidence on hand, and shows a LIVE preview of
 * what that binding actually grants — computed with the same canonical engine the runtime gate uses
 * (lib/governance/autonomyLadder), so the surface can never disagree with enforcement.
 */

import { useEffect, useMemo, useState } from 'react'
import { AUTONOMY_LADDER, evaluateAutonomy, type AutonomyLevel } from '@/lib/governance/autonomyLadder'

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

interface AutonomySession {
  role: string
  authorizedLevel: string
  evidence: string[]
}
interface AutonomyState {
  session: AutonomySession | null
  enforced: boolean
  ladder: AutonomyLevel[]
}

const ACCENT = '#7c3aed' // violet — the governed-autonomy axis

export default function AutonomyPanel() {
  const [state, setState] = useState<AutonomyState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // form state
  const [role, setRole] = useState('conductor')
  const [level, setLevel] = useState('L4')
  const [evidence, setEvidence] = useState<Set<string>>(new Set())

  const ladder = state?.ladder ?? AUTONOMY_LADDER
  const roles = useMemo(() => Array.from(new Set(ladder.flatMap((l) => l.roles))).sort(), [ladder])
  const evidenceTokens = useMemo(
    () => Array.from(new Set(ladder.map((l) => l.evidenceRequired).filter((e) => e && e !== 'none'))).sort(),
    [ladder],
  )

  async function refresh() {
    setLoading(true)
    try {
      const r = await fetch(amUrl('/api/autonomy'), { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const data = (await r.json()) as AutonomyState
        setState(data)
        if (data.session) {
          setRole(data.session.role)
          setLevel(data.session.authorizedLevel)
          setEvidence(new Set(data.session.evidence))
        }
      }
    } catch { /* agent-machine offline — keep canonical ladder defaults */ }
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    try {
      await fetch(amUrl('/api/autonomy'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      await refresh()
    } catch { /* best-effort */ }
    setBusy(false)
  }

  // Live preview: what does this binding actually grant? (canonical engine — same as runtime)
  const preview = useMemo(
    () => evaluateAutonomy(role, level, Array.from(evidence)),
    [role, level, evidence],
  )

  const toggleEvidence = (tok: string) =>
    setEvidence((prev) => { const n = new Set(prev); if (n.has(tok)) n.delete(tok); else n.add(tok); return n })

  return (
    <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: ACCENT }}>Autonomy</div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: state?.enforced ? '#5b21b6' : 'var(--color-text-tertiary)',
            background: state?.enforced ? 'rgba(124,58,237,0.12)' : 'var(--color-background-secondary)',
          }}
        >{state?.enforced ? 'enforced' : 'inert'}</span>
      </div>

      <div className="mt-1.5 text-[11px] text-[var(--color-text-secondary)]">
        {loading ? 'Loading…'
          : state?.session
            ? `Bound: ${state.session.role} @ ${state.session.authorizedLevel} · evidence: ${state.session.evidence.length ? state.session.evidence.join(', ') : 'none'}`
            : 'No session bound — the runtime gate is inert (agent runs unrestricted by autonomy).'}
      </div>

      {/* Role */}
      <div className="mt-3 flex items-center gap-2">
        <span className="w-16 text-[11px] text-[var(--color-text-tertiary)]">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
        >
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Level pills */}
      <div className="mt-2 flex items-center gap-2">
        <span className="w-16 text-[11px] text-[var(--color-text-tertiary)]">Level</span>
        <div className="flex flex-wrap gap-1.5">
          {ladder.map((l) => (
            <button
              key={l.level}
              onClick={() => setLevel(l.level)}
              title={`${l.label} · gate: ${l.gate} · needs: ${l.evidenceRequired}`}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                level === l.level
                  ? 'font-semibold'
                  : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
              }`}
              style={level === l.level ? { borderColor: ACCENT, background: 'rgba(124,58,237,0.12)', color: '#5b21b6' } : undefined}
            >{l.level}</button>
          ))}
        </div>
      </div>

      {/* Evidence checkboxes */}
      <div className="mt-2 flex items-start gap-2">
        <span className="w-16 pt-1 text-[11px] text-[var(--color-text-tertiary)]">Evidence</span>
        <div className="flex flex-wrap gap-2">
          {evidenceTokens.map((tok) => (
            <label key={tok} className="flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={evidence.has(tok)} onChange={() => toggleEvidence(tok)} />
              {tok}
            </label>
          ))}
        </div>
      </div>

      {/* Live grant preview (canonical engine) */}
      <div className="mt-3 rounded-xl bg-[var(--color-background-secondary)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
        Grants <span className="font-semibold" style={{ color: ACCENT }}>{preview.grantedLevel}</span> ({preview.decision})
        {preview.demoted ? ` — ${preview.reason}` : ` · ceiling ${preview.roleCeiling}`}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          disabled={busy}
          onClick={() => void post({ action: 'bind', role, level, evidence: Array.from(evidence) })}
          className="rounded-full px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          style={{ background: ACCENT }}
        >Bind</button>
        <button
          disabled={busy || !state?.enforced}
          onClick={() => void post({ action: 'clear' })}
          className="rounded-full border border-[var(--color-border-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)] disabled:opacity-50"
        >Clear</button>
      </div>
    </div>
  )
}

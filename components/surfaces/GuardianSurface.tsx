'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

// Guardian — the parent / administrator cockpit. A private, on-device overview of a learner: where they
// are, what's due, what they've mastered. Read-only v1 over existing learning endpoints; multi-learner
// rosters + coach assignment are the next step (and where the socioprophet integration plugs in).

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null
    return (await r.json()) as T
  } catch { return null }
}

interface Progress { brief?: string; artifact?: { lens: string; text: string } | null }
interface Due { due?: unknown[]; total?: number }
interface Stats { skills?: { count?: number }; experiences?: { count?: number }; evalCases?: { count?: number } }

export function GuardianSurface() {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [due, setDue] = useState<Due | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reached, setReached] = useState(true)

  const load = useCallback(async () => {
    const [p, d, s] = await Promise.all([
      safeJson<Progress>(amUrl('/api/learning/progress?id=local')),
      safeJson<Due>(amUrl('/api/learning/srs/due')),
      safeJson<Stats>(amUrl('/api/learning/stats')),
    ])
    setProgress(p); setDue(d); setStats(s); setLoaded(true)
    setReached(!!(p || d || s))
  }, [])
  useEffect(() => { void load() }, [load])

  const dueNow = due?.due?.length ?? 0
  const skills = stats?.skills?.count ?? 0
  const experiences = stats?.experiences?.count ?? 0
  const brief = progress?.brief?.trim()
  const record = progress?.artifact?.text?.trim()

  const tiles = [
    { label: 'Due to review', value: dueNow, hint: 'flashcards ready now' },
    { label: 'Skills mastered', value: skills, hint: 'distilled from practice' },
    { label: 'Sessions logged', value: experiences, hint: 'verified learning turns' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-[var(--color-border-secondary)] px-6 py-4">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Guardian</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-text-tertiary)]">
          A private overview of your learner — progress, what’s due, what they’ve mastered. Everything
          stays on this device.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /> This learner
          </span>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">multi-learner rosters coming</span>
          <div className="flex-1" />
          <button onClick={() => window.dispatchEvent(new CustomEvent('noetica:navigate', { detail: 'workrooms' }))}
            className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-accent)]">
            Start a live session with a coach →
          </button>
        </div>
      </div>

      {!loaded ? (
        <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">Loading…</p>
      ) : !reached ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="text-[13px] text-[var(--color-text-secondary)]">Couldn’t reach the learning backend.</p>
            <button onClick={() => void load()} className="mt-3 rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-background-primary)]">Retry</button>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-[var(--color-border-secondary)] p-4">
                <div className="text-[22px] font-semibold tabular-nums text-[var(--color-text-primary)]">{t.value}</div>
                <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">{t.label}</div>
                <div className="text-[10.5px] text-[var(--color-text-tertiary)]">{t.hint}</div>
              </div>
            ))}
          </div>

          {brief ? (
            <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Where they are</div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-primary)]">{brief}</p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-tertiary)]">No learning history yet — once they start in the Academy, their path and gaps show here.</p>
          )}

          {record && (
            <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Record</div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{record}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

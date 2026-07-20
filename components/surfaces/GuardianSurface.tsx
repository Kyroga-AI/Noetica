'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

// Guardian — the parent / administrator cockpit. A private, on-device overview of a learner: where they
// are, what's due, what they've mastered. Multi-learner roster over the local profiles (/api/learning/learners);
// switch between learners, hand off to a live coach. Coach assignment is where the socioprophet integration plugs in.

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null
    return (await r.json()) as T
  } catch { return null }
}

interface Learner { id: string; name: string; track: 'k12' | 'degree' | 'professional' | null }
interface Progress { brief?: string; artifact?: { lens: string; text: string } | null }
interface Due { due?: unknown[]; total?: number }
interface Stats { skills?: { count?: number }; experiences?: { count?: number }; evalCases?: { count?: number } }

const TRACK_LABEL: Record<string, string> = { k12: 'K-12', degree: 'Degree', professional: 'Professional' }

export function GuardianSurface() {
  const [roster, setRoster] = useState<Learner[]>([])
  const [selected, setSelected] = useState<string>('local')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [due, setDue] = useState<Due | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reached, setReached] = useState(true)

  // Roster loads once; the device-global signals (due, stats) load with it. Progress is per-learner.
  useEffect(() => { void (async () => {
    const r = await safeJson<{ learners: Learner[] }>(amUrl('/api/learning/learners'))
    const list = r?.learners ?? []
    setRoster(list)
    if (list.length) setSelected(list[0].id)
    const [d, s] = await Promise.all([
      safeJson<Due>(amUrl('/api/learning/srs/due')),
      safeJson<Stats>(amUrl('/api/learning/stats')),
    ])
    setDue(d); setStats(s)
    setReached(!!(list.length || d || s))
  })() }, [])

  const loadProgress = useCallback(async (id: string) => {
    setLoaded(false)
    const p = await safeJson<Progress>(amUrl(`/api/learning/progress?id=${encodeURIComponent(id)}`))
    setProgress(p); setLoaded(true)
  }, [])
  useEffect(() => { void loadProgress(selected) }, [selected, loadProgress])

  const dueNow = due?.due?.length ?? 0
  const skills = stats?.skills?.count ?? 0
  const experiences = stats?.experiences?.count ?? 0
  const brief = progress?.brief?.trim()
  const record = progress?.artifact?.text?.trim()
  const current = roster.find((l) => l.id === selected)

  const tiles = [
    { label: 'Due to review', value: dueNow, hint: 'flashcards ready now (device-wide)' },
    { label: 'Skills mastered', value: skills, hint: 'distilled from practice' },
    { label: 'Sessions logged', value: experiences, hint: 'verified learning turns' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-[var(--color-border-secondary)] px-6 py-4">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Guardian</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-text-tertiary)]">
          A private overview of your learners — progress, what’s due, what they’ve mastered. Everything
          stays on this device.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {roster.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /> This device
            </span>
          ) : roster.map((l) => (
            <button key={l.id} onClick={() => setSelected(l.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                l.id === selected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.id === selected ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }} />
              {l.name}{l.track ? <span className="text-[10px] opacity-70">· {TRACK_LABEL[l.track] ?? l.track}</span> : null}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => window.dispatchEvent(new CustomEvent('noetica:navigate', { detail: 'workrooms' }))}
            className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-accent)]">
            Start a live session with a coach →
          </button>
        </div>
      </div>

      {!reached ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="text-[13px] text-[var(--color-text-secondary)]">Couldn’t reach the learning backend.</p>
            <button onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-background-primary)]">Retry</button>
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

          {!loaded ? (
            <p className="px-6 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">Loading {current?.name ?? 'learner'}…</p>
          ) : brief ? (
            <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Where {current?.name ?? 'they'} {current ? 'is' : 'are'}</div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-primary)]">{brief}</p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-tertiary)]">No learning history yet for {current?.name ?? 'this learner'} — once they start in the Academy, their path and gaps show here.</p>
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

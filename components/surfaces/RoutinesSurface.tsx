'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

// Routines — recurring agent runs on a schedule. Each firing creates a run (see Dispatch). v1 fires only
// while the app is open; a persistent daemon is a later step (surfaced honestly below).

type ScheduleKind = 'hourly' | 'daily' | 'weekly'
interface Schedule { kind: ScheduleKind; hour?: number; minute?: number; weekday?: number }
interface Routine {
  id: string; title: string; prompt: string; role: string
  schedule: Schedule; enabled: boolean; createdAt: number; lastRun?: number; nextRun: number
}

const ROLES = ['general', 'researcher', 'coder', 'reviewer', 'analyst', 'planner'] as const
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describe(s: Schedule): string {
  const hh = String(s.hour ?? 9).padStart(2, '0'), mm = String(s.minute ?? 0).padStart(2, '0')
  if (s.kind === 'hourly') return `Hourly at :${mm}`
  if (s.kind === 'daily') return `Daily at ${hh}:${mm}`
  return `Weekly · ${DAYS[s.weekday ?? 1]} at ${hh}:${mm}`
}
function whenNext(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export function RoutinesSurface() {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  // draft
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [role, setRole] = useState('general')
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [weekday, setWeekday] = useState(1)

  const load = useCallback(async () => {
    try { const r = await fetch(amUrl('/api/routines')); if (r.ok) { const j = (await r.json()) as { routines?: Routine[] }; setRoutines(j.routines ?? []) } } catch { /* */ }
  }, [])
  useEffect(() => { void load() }, [load])

  async function save(routine: Partial<Routine>) {
    const r = await fetch(amUrl('/api/routines'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(routine) })
    if (!r.ok) throw new Error('failed')
    await load()
  }

  async function create() {
    if (!prompt.trim() || creating) return
    setCreating(true); setError('')
    try {
      const schedule: Schedule = { kind, minute, ...(kind !== 'hourly' ? { hour } : {}), ...(kind === 'weekly' ? { weekday } : {}) }
      await save({ title: title.trim() || prompt.trim().slice(0, 60), prompt: prompt.trim(), role, schedule, enabled: true })
      setTitle(''); setPrompt('')
    } catch { setError('Could not save the routine — the runtime may be warming up.') } finally { setCreating(false) }
  }

  async function toggle(rt: Routine) { try { await save({ ...rt, enabled: !rt.enabled }) } catch { /* */ } }
  async function remove(id: string) { try { await fetch(amUrl(`/api/routines/${id}`), { method: 'DELETE' }); await load() } catch { /* */ } }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Composer */}
      <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border-secondary)] p-4">
        <h2 className="mb-1 text-[15px] font-semibold text-[var(--color-text-primary)]">Routines</h2>
        <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">Run an agent on a schedule. Each firing shows up in Dispatch.</p>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name (optional)"
          className="mb-2 w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]" />
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should it do each time?"
          className="mb-2 h-20 w-full resize-none rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]" />

        <div className="mb-2 flex items-center gap-2">
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-[12px] capitalize text-[var(--color-text-secondary)] outline-none">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}
            className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-[12px] text-[var(--color-text-secondary)] outline-none">
            <option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
        </div>

        <div className="mb-3 flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
          {kind === 'weekly' && (
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}
              className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 outline-none">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
          {kind !== 'hourly' && (
            <>
              <span>at</span>
              <input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                className="w-14 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-center tabular-nums outline-none" />
              <span>:</span>
            </>
          )}
          {kind === 'hourly' && <span>at minute</span>}
          <input type="number" min={0} max={59} value={minute} onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
            className="w-14 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-center tabular-nums outline-none" />
        </div>

        <button onClick={() => void create()} disabled={!prompt.trim() || creating}
          className="rounded-lg bg-[var(--color-text-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--color-background-primary)] transition disabled:opacity-40">
          {creating ? 'Saving…' : 'Add routine'}
        </button>
        {error && <p className="mt-2 text-[11px] text-[#dc2626]">{error}</p>}
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">Routines fire while the app is running. An always-on daemon is coming.</p>
      </div>

      {/* List */}
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {routines.length === 0 ? (
          <div className="flex h-full items-center justify-center"><p className="text-[13px] text-[var(--color-text-tertiary)]">No routines yet — add one on the left.</p></div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {routines.map((rt) => (
              <div key={rt.id} className="flex items-start gap-3 rounded-xl border border-[var(--color-border-secondary)] px-3.5 py-3">
                <button onClick={() => void toggle(rt)} title={rt.enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}
                  className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition ${rt.enabled ? 'bg-[var(--color-accent)] justify-end' : 'bg-[var(--color-border-secondary)] justify-start'}`}>
                  <span className="h-3 w-3 rounded-full bg-white" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[var(--color-text-primary)]">{rt.title}</div>
                  <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-secondary)]">{rt.prompt}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                    <span className="capitalize">{rt.role}</span><span>·</span>
                    <span>{describe(rt.schedule)}</span>
                    {rt.enabled && <><span>·</span><span>next {whenNext(rt.nextRun)}</span></>}
                  </div>
                </div>
                <button onClick={() => void remove(rt.id)} title="Delete routine"
                  className="mt-0.5 shrink-0 rounded-md p-1 text-[var(--color-text-tertiary)] transition hover:text-[#dc2626]">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M2.5 3.5h9M5.5 3.5V2.5h3v1M4 3.5l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

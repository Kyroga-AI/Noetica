'use client'

import { useEffect, useState } from 'react'

/**
 * CalendarSurface — sovereign Calendar (Prophet Workspace). Subscribe to any .ics feed (CalDAV export, a public
 * Google/Apple calendar, holidays, a team feed) and read the merged agenda — no Google account, just the open
 * iCalendar standard over HTTP, parsed locally. Feeds are encrypted at rest by the backend (/api/calendar/feeds).
 */
type CalEvent = { uid: string; summary: string; start: string; end?: string; location?: string; allDay: boolean; feed?: string }
type Feed = { url: string; name?: string }
type Resp = { feeds: Feed[]; events: CalEvent[] }

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

function fmtDay(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(e: CalEvent): string {
  if (e.allDay) return 'all day'
  const d = new Date(e.start)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
const dayKey = (iso: string) => (iso.length >= 10 ? iso.slice(0, 10) : iso)

export function CalendarSurface() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function load() {
    setLoading(true)
    fetch(amUrl('/api/calendar/feeds'), { signal: AbortSignal.timeout(20000) })
      .then((r) => r.ok ? r.json() : null).then((d: Resp | null) => { if (d) setData(d) })
      .catch(() => setErr('backend unavailable')).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function add() {
    if (!/^https?:\/\//i.test(url.trim())) { setErr('Enter an https URL to an .ics feed.'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch(amUrl('/api/calendar/feeds'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `add ${r.status}`)
      setUrl(''); setName(''); load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'add failed') } finally { setBusy(false) }
  }
  async function remove(feedUrl: string) { await fetch(amUrl(`/api/calendar/feeds?url=${encodeURIComponent(feedUrl)}`), { method: 'DELETE' }).catch(() => {}); load() }

  // Upcoming events grouped by day (drop past days; cap for legibility).
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = (data?.events ?? []).filter((e) => dayKey(e.start) >= today)
  const byDay = new Map<string, CalEvent[]>()
  for (const e of upcoming) { const k = dayKey(e.start); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e) }
  const days = [...byDay.entries()].slice(0, 30)

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Calendar</div>
      <p className="mb-5 max-w-2xl text-xs text-[var(--color-text-secondary)]">Subscribe to any iCalendar (.ics) feed — a CalDAV export, a public Google/Apple calendar, holidays, a team feed. Sovereign: parsed locally, feeds encrypted at rest, no third-party account.</p>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* Agenda */}
        <div>
          {loading && <div className="text-xs text-[var(--color-text-tertiary)]">Loading agenda…</div>}
          {!loading && days.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] py-12 text-center text-sm text-[var(--color-text-tertiary)]">
              {data?.feeds.length ? 'No upcoming events in your feeds.' : 'Subscribe to a feed on the right to see your agenda.'}
            </div>
          )}
          <div className="space-y-4">
            {days.map(([day, evs]) => (
              <div key={day}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">{fmtDay(day)}</div>
                <div className="space-y-1.5">
                  {evs.map((e, i) => (
                    <div key={`${e.uid}-${i}`} className="flex items-start gap-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                      <div className="w-16 shrink-0 pt-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">{fmtTime(e)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[var(--color-text-primary)]">{e.summary}</div>
                        {(e.location || e.feed) && <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{[e.location, e.feed].filter(Boolean).join(' · ')}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feeds manager */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
            <div className="mb-2 text-xs font-semibold text-[var(--color-text-primary)]">Add a feed</div>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/calendar.ics" className="mb-2 w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)]" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name (optional)" className="mb-2 w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)]" />
            <button onClick={() => void add()} disabled={busy} className="w-full rounded-xl bg-[#1d4ed8] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">{busy ? 'Adding…' : 'Subscribe'}</button>
            {err && <div className="mt-2 text-[11px] text-[#dc2626]">{err}</div>}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Subscribed ({data?.feeds.length ?? 0})</div>
            <div className="space-y-1.5">
              {(data?.feeds ?? []).map((f) => (
                <div key={f.url} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
                  <span className="truncate text-[11px] text-[var(--color-text-secondary)]" title={f.url}>{f.name || f.url}</span>
                  <button onClick={() => void remove(f.url)} className="shrink-0 text-[11px] text-[#dc2626] hover:underline">remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

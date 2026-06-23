'use client'

import { useEffect, useState } from 'react'
import { useConnectorAuth } from '@/lib/auth/context'

type CalEvent = {
  id: string
  summary: string
  start: string
  end: string
}

async function fetchTodaysEvents(accessToken: string): Promise<CalEvent[]> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

  const params = new URLSearchParams({
    timeMin: startOfDay,
    timeMax: endOfDay,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '10',
  })

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) throw new Error(`Calendar API ${res.status}`)

  const data = await res.json() as {
    items?: Array<{
      id: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
    }>
  }

  return (data.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? '(no title)',
    start: item.start?.dateTime ?? item.start?.date ?? '',
    end: item.end?.dateTime ?? item.end?.date ?? '',
  }))
}

function fmtTime(iso: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

export function CalendarPanel() {
  const { store } = useConnectorAuth()
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const google = store.google
  const isConnected = google?.status === 'connected' && !!google.accessToken

  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isConnected || !google?.accessToken) { setEvents([]); return }
    setLoading(true)
    fetchTodaysEvents(google.accessToken)
      .then((evts) => { setEvents(evts); setError('') })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [isConnected, google?.accessToken])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Calendar</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{today}</div>
          </div>
          {isConnected && google?.userInfo?.name && (
            <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[9px] font-semibold text-[#16a34a]">Live</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!isConnected ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
            Connect Google in Settings → Connections to see your calendar.
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--color-background-secondary)]" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{error}</div>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
            No events today.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[var(--color-text-secondary)]">
              Today · {events.length} event{events.length !== 1 ? 's' : ''}
            </div>
            {events.map((evt) => (
              <div key={evt.id} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{evt.summary}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                  {fmtTime(evt.start)}{evt.end ? ` – ${fmtTime(evt.end)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => window.dispatchEvent(new CustomEvent('noetica:open-settings', { detail: 'workspace' }))} className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
          {isConnected ? '+ Schedule from task' : '+ Set up your calendar (CalDAV)'}
        </button>
      </div>
    </div>
  )
}

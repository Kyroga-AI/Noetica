'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * JitsiSurface — embedded Jitsi Meet video conferencing for Workrooms (Matrix + Jitsi = the collaboration
 * stack Element uses). Sovereign-configurable: defaults to a public instance but accepts a self-hosted Jitsi
 * domain (stored locally), so calls can stay on your own infrastructure. Loads the Jitsi IFrame External API
 * on demand and mounts the meeting into a container.
 */
type JitsiApi = { dispose: () => void }
type JitsiCtor = new (domain: string, opts: Record<string, unknown>) => JitsiApi

const DOMAIN_KEY = 'noetica.jitsi.domain'

export function JitsiSurface() {
  const [domain, setDomain] = useState('meet.jit.si')
  const [room, setRoom] = useState('')
  const [joined, setJoined] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<JitsiApi | null>(null)

  useEffect(() => {
    try { const saved = localStorage.getItem(DOMAIN_KEY); if (saved) setDomain(saved) } catch { /* no storage */ }
  }, [])

  function loadScript(d: string): Promise<JitsiCtor> {
    return new Promise((resolve, reject) => {
      const w = window as unknown as { JitsiMeetExternalAPI?: JitsiCtor }
      if (w.JitsiMeetExternalAPI) { resolve(w.JitsiMeetExternalAPI); return }
      const s = document.createElement('script')
      s.src = `https://${d}/external_api.js`
      s.async = true
      s.onload = () => (w.JitsiMeetExternalAPI ? resolve(w.JitsiMeetExternalAPI) : reject(new Error('api missing')))
      s.onerror = () => reject(new Error('script load failed'))
      document.body.appendChild(s)
    })
  }

  async function join() {
    const r = (room.trim() || `noetica-${Math.random().toString(36).slice(2, 8)}`).replace(/[^a-zA-Z0-9_-]/g, '-')
    setStatus('loading')
    try { localStorage.setItem(DOMAIN_KEY, domain) } catch { /* ignore */ }
    try {
      const Api = await loadScript(domain)
      apiRef.current?.dispose()
      if (!containerRef.current) return
      containerRef.current.innerHTML = ''
      apiRef.current = new Api(domain, {
        roomName: r,
        parentNode: containerRef.current,
        width: '100%', height: '100%',
        configOverwrite: { prejoinPageEnabled: true },
      })
      setRoom(r); setJoined(true); setStatus('ready')
    } catch { setStatus('error') }
  }

  function leave() { apiRef.current?.dispose(); apiRef.current = null; setJoined(false); setStatus('idle'); if (containerRef.current) containerRef.current.innerHTML = '' }
  useEffect(() => () => { apiRef.current?.dispose() }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-primary)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-secondary)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Video</h1>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">Jitsi · {joined ? `in ${room}` : 'workroom calls'}</span>
        <div className="ml-auto flex items-center gap-2">
          {!joined ? (
            <>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} title="Jitsi domain (self-host for sovereignty)"
                className="w-36 rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-primary)]" />
              <input value={room} onChange={(e) => setRoom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void join() }} placeholder="room name (blank = new)"
                className="w-44 rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-primary)]" />
              <button onClick={() => void join()} disabled={status === 'loading'} className="rounded-md bg-[var(--color-accent,#0891b2)] px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50">{status === 'loading' ? 'Joining…' : 'Start / Join'}</button>
            </>
          ) : (
            <button onClick={leave} className="rounded-md bg-[#ef4444] px-3 py-1 text-[11px] font-medium text-white">Leave</button>
          )}
        </div>
      </header>
      {status === 'error' && <div className="px-5 py-2 text-[11px] text-[#ef4444]">Couldn’t load Jitsi from {domain} — check the domain or your connection (self-hosted instances need a reachable external_api.js).</div>}
      <div className="relative flex-1">
        {!joined && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-[var(--color-text-tertiary)]">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="2" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 10l6-3v10l-6-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            <p className="text-xs">Start a call for this workroom.</p>
            <p className="text-[10px]">Set a self-hosted Jitsi domain above to keep calls sovereign.</p>
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}

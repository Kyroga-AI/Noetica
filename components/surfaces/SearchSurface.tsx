'use client'

import { useState } from 'react'

/**
 * Data → Search — local (lampstand desktop index) vs platform (sherlock evidence-answer) search,
 * side by side. Each source is queried independently; one being down never blocks the other.
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

type Scope = 'all' | 'local' | 'platform'
type Hit = { source: 'local' | 'platform'; title: string; ref: string; snippet: string; score: number }
type SourceResult = { ok: boolean; configured: boolean; hits: Hit[]; error?: string }
type Result = { query: string; local: SourceResult; platform: SourceResult }

function SourceColumn({ label, tint, r }: { label: string; tint: string; r?: SourceResult }) {
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: tint }}>{label}</span>
        {r && <span className="text-[10px] text-[var(--color-text-tertiary)]">{r.configured ? (r.ok ? `${r.hits.length} hits` : (r.error ?? 'unreachable')) : 'not configured'}</span>}
      </div>
      <div className="max-h-[52vh] overflow-y-auto p-2">
        {!r ? <div className="p-3 text-[11px] text-[var(--color-text-tertiary)]">—</div>
          : !r.configured ? <div className="p-3 text-[11px] text-[var(--color-text-tertiary)]">Set the endpoint in Settings to enable {label.toLowerCase()} search.</div>
          : !r.ok ? <div className="p-3 text-[11px] text-[#dc2626]">{r.error ?? 'unreachable'}</div>
          : r.hits.length === 0 ? <div className="p-3 text-[11px] text-[var(--color-text-tertiary)]">No results.</div>
          : r.hits.map((h, i) => (
            <div key={i} className="rounded-lg px-2.5 py-2 transition hover:bg-[var(--color-background-secondary)]">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-[var(--color-text-primary)]">{h.title || h.ref}</span>
                {h.score > 0 && <span className="shrink-0 text-[9px] text-[var(--color-text-tertiary)]">{h.score.toFixed(2)}</span>}
              </div>
              {h.snippet && <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-text-secondary)]">{h.snippet}</div>}
              {h.ref && <div className="mt-0.5 truncate text-[9px] text-[var(--color-text-tertiary)]">{h.ref}</div>}
            </div>
          ))}
      </div>
    </div>
  )
}

export function SearchSurface() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function run() {
    if (!query.trim() || loading) return
    setLoading(true); setErr('')
    try {
      const res = await fetch(`${amBase()}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: query.trim(), scope }) })
      if (!res.ok) throw new Error(`search ${res.status}`)
      setResult((await res.json()) as Result)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'search failed — is the agent-machine backend running?')
    } finally { setLoading(false) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div>
          <div className="text-lg font-semibold text-[var(--color-text-primary)]">Search</div>
          <div className="text-xs text-[var(--color-text-secondary)]">Local (<strong>on-device</strong> — your ingested docs + memory) vs platform (<strong>sherlock</strong> evidence-answer) — side by side.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={(e) => { e.preventDefault(); void run() }} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" /><path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files + knowledge…" className="min-w-0 flex-1 bg-transparent text-sm outline-none text-[var(--color-text-primary)]" />
            <button type="submit" disabled={loading || !query.trim()} className="shrink-0 rounded-lg bg-[#1d4ed8] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">{loading ? '…' : 'Search'}</button>
          </form>
          <div className="flex items-center gap-1">
            {(['all', 'local', 'platform'] as Scope[]).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`rounded-lg px-2.5 py-1 text-[11px] font-medium capitalize transition ${scope === s ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>{s}</button>
            ))}
          </div>
        </div>

        {err && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-2 text-xs text-[#dc2626]">{err}</div>}

        <div className="flex flex-col gap-3 sm:flex-row">
          {(scope === 'all' || scope === 'local') && <SourceColumn label="Local · on-device" tint="var(--color-accent)" r={result?.local} />}
          {(scope === 'all' || scope === 'platform') && <SourceColumn label="Platform · sherlock" tint="#1d4ed8" r={result?.platform} />}
        </div>
      </div>
    </div>
  )
}

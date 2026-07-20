'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

// Dispatch — launch a standalone background agent and watch its run. A "run" executes outside any chat
// (the shared spine in agent-machine: /api/runs → runSubAgent). v1 polls for status/result; live token
// streaming is a follow-up (the headless loop doesn't stream yet).

type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
interface AgentRun {
  id: string; title: string; prompt: string; role: string
  status: RunStatus; source: 'manual' | 'routine'; routineId?: string
  createdAt: number; startedAt?: number; finishedAt?: number; result?: string; error?: string
}

const ROLES = ['general', 'researcher', 'coder', 'reviewer', 'analyst', 'planner'] as const
const STATUS_DOT: Record<RunStatus, string> = {
  queued: 'var(--color-text-tertiary)', running: 'var(--color-accent)',
  done: 'var(--color-accent)', error: '#dc2626', cancelled: 'var(--color-text-tertiary)',
}
const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'queued', running: 'running', done: 'done', error: 'error', cancelled: 'cancelled',
}

function elapsed(run: AgentRun): string {
  const end = run.finishedAt ?? Date.now()
  const start = run.startedAt ?? run.createdAt
  const s = Math.max(0, Math.round((end - start) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function DispatchSurface() {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [role, setRole] = useState<string>('general')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(amUrl('/api/runs'))
      if (r.ok) { const j = (await r.json()) as { runs?: AgentRun[] }; setRuns(j.runs ?? []) }
    } catch { /* offline — keep last */ }
  }, [])
  // Poll while any run is active; slow to idle otherwise.
  useEffect(() => {
    void load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [load])

  async function create() {
    if (!prompt.trim() || creating) return
    setCreating(true); setError('')
    try {
      const r = await fetch(amUrl('/api/runs'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), role }),
      })
      if (!r.ok) throw new Error('failed')
      const j = (await r.json()) as { run?: AgentRun }
      setPrompt(''); if (j.run) setSelectedId(j.run.id)
      void load()
    } catch { setError('Could not start the run — the runtime may be warming up.') } finally { setCreating(false) }
  }

  async function cancel(id: string) {
    try { await fetch(amUrl(`/api/runs/${id}/cancel`), { method: 'POST' }); void load() } catch { /* */ }
  }

  function sendToChat(run: AgentRun) {
    if (!run.result) return
    window.dispatchEvent(new CustomEvent('noetica:run-to-chat', { detail: { title: run.title, result: run.result } }))
  }

  const selected = runs.find((r) => r.id === selectedId) ?? null

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left: composer + run list */}
      <div className="flex w-[380px] shrink-0 flex-col border-r border-[var(--color-border-secondary)]">
        <div className="border-b border-[var(--color-border-secondary)] p-4">
          <h2 className="mb-1 text-[15px] font-semibold text-[var(--color-text-primary)]">Dispatch</h2>
          <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">Launch a background agent. It runs on its own — off the chat — and reports back here.</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create() }}
            placeholder="What should the agent do? (⌘↵ to dispatch)"
            className="h-20 w-full resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
          <div className="mt-2 flex items-center gap-2">
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-[12px] capitalize text-[var(--color-text-secondary)] outline-none">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => void create()} disabled={!prompt.trim() || creating}
              className="rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-background-primary)] transition disabled:opacity-40">
              {creating ? 'Dispatching…' : 'Dispatch'}
            </button>
          </div>
          {error && <p className="mt-2 text-[11px] text-[#dc2626]">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {runs.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">No runs yet.</p>
          ) : runs.map((run) => (
            <button key={run.id} onClick={() => setSelectedId(run.id)}
              className={`flex w-full flex-col gap-1 border-b border-[var(--color-border-tertiary)] px-4 py-2.5 text-left transition hover:bg-[var(--color-background-secondary)] ${selectedId === run.id ? 'bg-[var(--color-background-secondary)]' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${run.status === 'running' ? 'animate-pulse' : ''}`} style={{ background: STATUS_DOT[run.status] }} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-text-primary)]">{run.title}</span>
              </div>
              <div className="flex items-center gap-2 pl-3.5 text-[11px] text-[var(--color-text-tertiary)]">
                <span className="capitalize">{run.role}</span>
                <span>·</span>
                <span>{STATUS_LABEL[run.status]}</span>
                <span>·</span>
                <span className="tabular-nums">{elapsed(run)}</span>
                {run.source === 'routine' && <><span>·</span><span>routine</span></>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-[13px] text-[var(--color-text-tertiary)]">Select a run to see its result, or dispatch a new one.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <div className="mb-3 flex items-start gap-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${selected.status === 'running' ? 'animate-pulse' : ''}`} style={{ background: STATUS_DOT[selected.status] }} />
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{selected.title}</h3>
                <p className="mt-0.5 text-[11.5px] text-[var(--color-text-tertiary)]">
                  <span className="capitalize">{selected.role}</span> · {STATUS_LABEL[selected.status]} · {elapsed(selected)}
                  {selected.source === 'routine' && ' · from a routine'}
                </p>
              </div>
              {(selected.status === 'queued' || selected.status === 'running') && (
                <button onClick={() => void cancel(selected.id)}
                  className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-secondary)] transition hover:text-[#dc2626]">Cancel</button>
              )}
            </div>

            <div className="mb-4 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Task</div>
              <p className="whitespace-pre-wrap text-[12.5px] text-[var(--color-text-secondary)]">{selected.prompt}</p>
            </div>

            {selected.status === 'running' || selected.status === 'queued' ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">The agent is working… this updates automatically.</p>
            ) : selected.status === 'error' ? (
              <div className="rounded-xl border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-[12.5px] text-[#b91c1c]">{selected.error || 'The run failed.'}</div>
            ) : selected.status === 'cancelled' ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">Cancelled.</p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Result</div>
                  <button onClick={() => sendToChat(selected)}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-accent)]">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Send to chat
                  </button>
                </div>
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-primary)]">{selected.result}</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

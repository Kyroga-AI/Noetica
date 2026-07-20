'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Workstation → Deploy — the local PaaS control plane (SourceOS Continuum / Porter).
 * Shows control-plane readiness and runs `make dev-up / dev-down / shim-test` in the
 * continuum repo, streaming the console live. This closes the local onboard→deploy loop.
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

type Status = {
  continuumPath: string
  hasRepo: boolean
  runtime: { kind: boolean; podman: boolean; docker: boolean; go: boolean; kubectl: boolean; make: boolean }
  clusterUp: boolean
  clusters: string[]
  ready: boolean
  notes: string[]
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[#fef2f2] text-[#dc2626]'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[var(--color-accent)]' : 'bg-[#dc2626]'}`} />
      {label}
    </span>
  )
}

export function DeploySurface() {
  const [status, setStatus] = useState<Status | null>(null)
  const [statusErr, setStatusErr] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(async () => {
    setStatusErr('')
    try {
      const res = await fetch(`${amBase()}/api/deploy/status`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      setStatus((await res.json()) as Status)
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Could not reach agent-machine backend')
    }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [log])

  async function run(target: 'dev-up' | 'dev-down' | 'shim-test') {
    if (running) return
    setRunning(target); setLog([]); setExitCode(null)
    try {
      const res = await fetch(`${amBase()}/api/deploy/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }),
      })
      if (!res.ok || !res.body) throw new Error('failed to start')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const ev = JSON.parse(line.slice(5)) as { line?: string; stream?: string; error?: string; code?: number }
            if (ev.error) setLog((l) => [...l, `✗ ${ev.error}`])
            else if (ev.line != null) setLog((l) => [...l, (ev.stream === 'err' ? '⚠ ' : '') + ev.line])
            else if (ev.code != null) setExitCode(ev.code)
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setLog((l) => [...l, `✗ ${e instanceof Error ? e.message : 'run failed'}`])
    } finally {
      setRunning(null)
      void loadStatus()
    }
  }

  const rt = status?.runtime
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-[var(--color-text-primary)]">Deploy</span>
            <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">Local PaaS · SourceOS Continuum</span>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">Bring up the local control plane (kind + ingress + Argo + Cloud Shell + porter-shim) and run it on-device.</div>
        </div>

        {/* Status */}
        <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-3">
            <div className="text-xs font-semibold text-[#1d4ed8]">Control plane status</div>
            <button onClick={() => void loadStatus()} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">Refresh</button>
          </div>
          {statusErr ? (
            <div className="px-5 py-4 text-xs text-[#dc2626]">{statusErr} — is the agent-machine backend running (dev:app)?</div>
          ) : !status ? (
            <div className="px-5 py-4 text-xs text-[var(--color-text-tertiary)]">Checking…</div>
          ) : (
            <div className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip ok={status.hasRepo} label="continuum repo" />
                {rt && <><Chip ok={rt.make} label="make" /><Chip ok={rt.kind} label="kind" /><Chip ok={rt.podman || rt.docker} label={rt.podman ? 'podman' : rt.docker ? 'docker' : 'runtime'} /><Chip ok={rt.go} label="go" /><Chip ok={rt.kubectl} label="kubectl" /></>}
                <Chip ok={status.clusterUp} label={status.clusterUp ? `cluster up (${status.clusters.join(', ')})` : 'no cluster'} />
              </div>
              <div className="truncate text-[11px] text-[var(--color-text-tertiary)]" title={status.continuumPath}>path: {status.continuumPath}</div>
              {status.notes.length > 0 && (
                <ul className="space-y-0.5 rounded-lg bg-[var(--color-background-secondary)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
                  {status.notes.map((n, i) => <li key={i}>• {n}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void run('dev-up')} disabled={!!running || !status?.ready}
            title={status?.ready ? 'kind + ingress + Argo + Cloud Shell + porter-shim' : 'prereqs missing (see status)'}
            className="rounded-xl bg-[#1d4ed8] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">
            {running === 'dev-up' ? 'Bringing up…' : 'Bring up (dev-up)'}
          </button>
          <button onClick={() => void run('dev-down')} disabled={!!running || !status?.hasRepo}
            className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3.5 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)] disabled:opacity-50">
            {running === 'dev-down' ? 'Tearing down…' : 'Tear down (dev-down)'}
          </button>
          <button onClick={() => void run('shim-test')} disabled={!!running || !status?.hasRepo || !status?.runtime.go}
            title="go vet + go test on the porter-shim — proves the control plane without a cluster"
            className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-3.5 py-2 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-50">
            {running === 'shim-test' ? 'Testing…' : 'Test shim (no cluster)'}
          </button>
        </div>

        {/* Console */}
        {(log.length > 0 || running) && (
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[#0b1020]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="text-[11px] font-semibold text-white/60">Console{running ? ` · ${running}` : ''}</span>
              {exitCode != null && <span className={`text-[11px] font-semibold ${exitCode === 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>exit {exitCode}</span>}
            </div>
            <div ref={logRef} className="max-h-80 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-white/80">
              {log.map((l, i) => <div key={i} className={l.startsWith('✗') ? 'text-[#f87171]' : l.startsWith('⚠') ? 'text-[#fbbf24]' : ''}>{l}</div>)}
              {running && <div className="text-white/40">…</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

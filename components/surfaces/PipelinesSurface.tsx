'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Workstation → Pipelines — the local GitOps view. The continuum/Porter control plane is PR-driven
 * GitOps; this shows the Argo CD Applications reconciling in the local cluster (sync + health).
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

type ArgoApp = { name: string; namespace: string; sync: string; health: string }
type Status = { gitops: { kubectl: boolean; argocd: boolean }; ci: { gh: boolean }; apps: ArgoApp[]; note?: string }

const syncColor = (s: string) => (s === 'Synced' ? 'var(--color-accent)' : s === 'OutOfSync' ? 'var(--color-attention)' : '#94a3b8')
const healthColor = (h: string) => (h === 'Healthy' ? 'var(--color-accent)' : h === 'Degraded' ? '#dc2626' : h === 'Progressing' ? '#1d4ed8' : '#94a3b8')

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'}`}><span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[var(--color-accent)]' : 'bg-[#94a3b8]'}`} />{label}</span>
}

export function PipelinesSurface() {
  const [data, setData] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setErr('')
    try {
      const res = await fetch(`${amBase()}/api/pipelines/status`)
      if (!res.ok) throw new Error(`pipelines ${res.status}`)
      setData((await res.json()) as Status)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach agent-machine backend') }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-[var(--color-text-primary)]">Pipelines · GitOps</div>
            <div className="text-xs text-[var(--color-text-secondary)]">PR-driven GitOps — Argo CD reconciles the local cluster. The porter-shim writes to Git; Argo applies.</div>
          </div>
          <button onClick={() => void load()} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">Refresh</button>
        </div>

        {err ? <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-2 text-xs text-[#dc2626]">{err} — run under dev:app</div>
          : !data ? <div className="text-xs text-[var(--color-text-tertiary)]">Loading…</div>
          : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip ok={data.gitops.kubectl} label="kubectl" />
                <Chip ok={data.gitops.argocd} label="Argo CD" />
                <Chip ok={data.ci.gh} label="gh (CI)" />
                {data.note && <span className="text-[11px] text-[var(--color-text-tertiary)]">{data.note}</span>}
              </div>

              {data.apps.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-8 text-center text-xs text-[var(--color-text-tertiary)]">
                  No Argo applications. Bring the control plane up (Workstation → Deploy → dev-up).
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-[var(--color-border-secondary)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--color-background-secondary)] text-[11px] text-[var(--color-text-tertiary)]">
                      <tr><th className="px-4 py-2 text-left font-semibold">Application</th><th className="px-4 py-2 text-left font-semibold">Namespace</th><th className="px-4 py-2 text-left font-semibold">Sync</th><th className="px-4 py-2 text-left font-semibold">Health</th></tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-secondary)]">
                      {data.apps.map((a) => (
                        <tr key={a.name} className="bg-[var(--color-background-primary)]">
                          <td className="px-4 py-2 font-medium text-[var(--color-text-primary)]">{a.name}</td>
                          <td className="px-4 py-2 font-mono text-[11px] text-[var(--color-text-tertiary)]">{a.namespace}</td>
                          <td className="px-4 py-2"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: syncColor(a.sync) }} />{a.sync}</span></td>
                          <td className="px-4 py-2"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: healthColor(a.health) }} />{a.health}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Workstation → Services — the DevSpaces. Our three trust namespaces mapped onto the Nocalhost
 * DevSpace model: self = an isolated BaseSpace (on-device), workspace/collective = MeshSpaces that
 * share a baseline (trust/header-routed). The isolation model IS the DevSpace model.
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

type DevSpace = {
  name: string; trustNamespace: string; kubeNamespace: string
  spaceType: 'base' | 'mesh'; status: 'active' | 'not_deployed' | 'unknown'
  application: string; devMode: string[]
}
type Listing = { hasCluster: boolean; nhctl: boolean; spaces: DevSpace[]; note?: string }

const STATUS_COLOR: Record<DevSpace['status'], string> = { active: '#16a34a', not_deployed: '#94a3b8', unknown: '#d97706' }

export function ServicesSurface() {
  const [data, setData] = useState<Listing | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const res = await fetch(`${amBase()}/api/devspace/list`)
      if (!res.ok) throw new Error(`devspace ${res.status}`)
      setData((await res.json()) as Listing)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach agent-machine backend') }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-[var(--color-text-primary)]">Services · DevSpaces</div>
            <div className="text-xs text-[var(--color-text-secondary)]">Trust namespaces as Nocalhost DevSpaces — <strong>self</strong> is an isolated BaseSpace (on-device); <strong>workspace/collective</strong> are MeshSpaces sharing a baseline.</div>
          </div>
          <button onClick={() => void load()} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">Refresh</button>
        </div>

        {err ? <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-2 text-xs text-[#dc2626]">{err} — run under dev:app</div>
          : !data ? <div className="text-xs text-[var(--color-text-tertiary)]">Loading…</div>
          : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${data.hasCluster ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fef2f2] text-[#dc2626]'}`}><span className={`h-1.5 w-1.5 rounded-full ${data.hasCluster ? 'bg-[#16a34a]' : 'bg-[#dc2626]'}`} />{data.hasCluster ? 'cluster reachable' : 'no cluster'}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${data.nhctl ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'}`}>nhctl {data.nhctl ? 'installed' : 'absent'}</span>
                {data.note && <span className="text-[var(--color-text-tertiary)]">{data.note}</span>}
              </div>

              <div className="space-y-2">
                {data.spaces.map((s) => (
                  <div key={s.trustNamespace} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{s.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${s.spaceType === 'base' ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#dbeafe] text-[#1d4ed8]'}`}>{s.spaceType === 'base' ? 'BaseSpace · isolated' : 'MeshSpace · shared'}</span>
                      <span className="rounded-full border border-[var(--color-border-secondary)] px-2 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">{s.status.replace('_', ' ')}</span>
                      <span className="ml-auto font-mono text-[10px] text-[var(--color-text-tertiary)]">{s.kubeNamespace}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.devMode.map((m) => (
                        <span key={m} className="rounded-md bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-secondary)]">{m}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { SurfaceGraph, type GraphNode, type GraphLink } from '@/components/graph/SurfaceGraph'
import type { GraphHealthStatus, TimeServiceStatus } from '@/lib/types/graph'
import type { NoeticaServiceStatus, NoeticaServiceCapabilityStatus } from '@/lib/contracts/noeticaService'
import { loadNoeticaStatus } from '@/lib/client/noeticaStatus'
import { useConnectorAuth } from '@/lib/auth/context'
import { useSettings } from '@/lib/settings/context'

type HealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown'

function StatusDot({ status }: { status: HealthStatus }) {
  const colors: Record<HealthStatus, string> = {
    healthy:  'bg-[var(--color-accent)]',
    degraded: 'bg-[#f59e0b]',
    failed:   'bg-[#ef4444]',
    unknown:  'bg-[var(--color-text-tertiary)]',
  }
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${colors[status]}`} />
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${
      accent
        ? 'border-[rgba(147,197,253,0.30)] bg-[rgba(29,78,216,0.08)]'
        : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]'
    }`}>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent ? 'text-[#60a5fa]' : 'text-[var(--color-text-primary)]'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">{title}</div>
      {action}
    </div>
  )
}

// Runs REAL async work and reflects its actual outcome (replaces the old cosmetic useFlash that just
// flipped to "done" after a setTimeout without doing anything).
function useAsyncAction() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  async function run(fn: () => Promise<void>) {
    setState('running')
    try { await fn(); setState('done') } catch { setState('error') }
    setTimeout(() => setState('idle'), 1600)
  }
  return { state, run }
}

// Really export the current HellGraph as a downloaded JSON snapshot (not a fake "Exported ✓" flash).
async function exportGraphSnapshot(): Promise<void> {
  const r = await fetch(amUrl('/api/graph/nodes'), { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error('graph fetch failed')
  const data = await r.json()
  const snapshot = { exportedAt: new Date().toISOString(), ...data }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `hellgraph-snapshot-${Date.now()}.json`
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

type VizNode = { id: string; label: string; kind: string; surface: string; primes: string; x: number; y: number; vx: number; vy: number }
type VizEdge = { from: string; to: string; label: string }

function GraphViz({ onNodeClick }: { onNodeClick?: (node: VizNode) => void }) {
  const VIEWS = [
    { key: 'document', label: 'Docs' },
    { key: 'domain', label: 'Domain' },
    { key: 'chat', label: 'Chat' },
    { key: 'all', label: 'All' },
  ] as const
  const [view, setView] = useState<string>('document')
  const [root, setRoot] = useState<string>('')
  const [g, setG] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [err, setErr] = useState(false)

  useEffect(() => {
    let on = true
    const q = amUrl(`/api/graph/surface?view=${view}&limit=44${root ? `&root=${encodeURIComponent(root)}` : ''}`)
    fetch(q)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('graph'))))
      .then((d: { nodes?: GraphNode[]; links?: GraphLink[] }) => { if (on) { setG({ nodes: d.nodes ?? [], links: d.links ?? [] }); setErr(false) } })
      .catch(() => { if (on) setErr(true) })
    return () => { on = false }
  }, [view, root])

  const focus = root ? g.nodes.find((n) => n.id === root) : undefined

  return (
    <div className="rounded-xl overflow-hidden border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border-tertiary)] px-3 py-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => { setView(v.key); setRoot('') }}
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold transition"
            style={{
              border: '1px solid ' + (view === v.key ? '#1d4ed8' : 'var(--color-border-secondary)'),
              background: view === v.key ? '#1d4ed8' : 'transparent',
              color: view === v.key ? '#fff' : 'var(--color-text-secondary)',
            }}
          >{v.label}</button>
        ))}
        {focus && (
          <span className="ml-auto flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
            <span className="truncate max-w-[160px]">focused: <b>{focus.label}</b></span>
            <button onClick={() => setRoot('')} className="font-semibold text-[#1d4ed8]">clear</button>
            {onNodeClick && (
              <button
                onClick={() => onNodeClick({ id: focus.id, label: focus.label, kind: focus.category, surface: focus.label, primes: '', x: 0, y: 0, vx: 0, vy: 0 })}
                className="font-semibold text-[#1d4ed8]"
              >explore in chat →</button>
            )}
          </span>
        )}
      </div>
      {err ? (
        <div className="flex h-48 items-center justify-center text-xs text-[var(--color-text-tertiary)]">Graph unavailable.</div>
      ) : g.nodes.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-xs text-[var(--color-text-tertiary)]">No atoms for this lens yet — try another view.</div>
      ) : (
        <SurfaceGraph nodes={g.nodes} links={g.links} width={600} height={340} onNodeClick={setRoot} />
      )}
    </div>
  )
}

type HealthCheckResult = { ok: boolean; latency_ms: number; detail?: string }

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

function useHealthCheck(endpoint: string) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [result, setResult] = useState<HealthCheckResult | null>(null)

  async function trigger() {
    setState('running')
    setResult(null)
    const started = Date.now()
    try {
      const res = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      const latency_ms = Date.now() - started
      if (res.ok) {
        setResult({ ok: true, latency_ms })
        setState('done')
      } else {
        setResult({ ok: false, latency_ms, detail: `HTTP ${res.status}` })
        setState('failed')
      }
    } catch (err) {
      setResult({ ok: false, latency_ms: Date.now() - started, detail: err instanceof Error ? err.message : 'unreachable' })
      setState('failed')
    }
    setTimeout(() => setState('idle'), 3000)
  }

  return { state, result, trigger }
}

const STUB_GRAPH: GraphHealthStatus = {
  graphId: 'sociosphere-primary',
  status: 'unknown',
  nodeCount: 0,
  edgeCount: 0,
  pendingIngestCount: 0,
  failedIngestCount: 0,
  orphanNodeCount: 0,
  duplicateEntityCount: 0,
  stalePartitionCount: 0,
  vectorIndexStatus: 'unknown',
}

const STUB_TIME: TimeServiceStatus = {
  serviceId: 'time-primary',
  status: 'unknown',
  logicalTime: '—',
  latestEventTime: '—',
  ledgerLagMs: 0,
  clockSkewMs: 0,
}

// ─── Graph Health tab ─────────────────────────────────────────────────────────

function GraphHealthTab({ graph, onTabChange, onAtomSelect, onRefresh }: { graph: GraphHealthStatus; onTabChange: (tab: ViewTab) => void; onAtomSelect?: (query: string) => void; onRefresh?: () => void }) {
  const [recentEvents, setRecentEvents] = useState<string[]>([])
  const [healthMsg, setHealthMsg] = useState('')
  const stalePartitions: string[] = []

  const loadRecent = useCallback(() => {
    return fetch(amUrl('/api/graph/nodes'), { signal: AbortSignal.timeout(4000) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('graph unreachable')))
      .then((data: { nodes?: Array<{ id: string; label: string; kind: string; surface: string; clock?: number; createdAt?: string }> } | null) => {
        if (!data?.nodes?.length) return
        const sorted = [...data.nodes].sort((a, b) => {
          if ((b.clock ?? 0) !== (a.clock ?? 0)) return (b.clock ?? 0) - (a.clock ?? 0)
          return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
        }).slice(0, 8)
        setRecentEvents(sorted.map(n => `${n.kind ?? 'Node'} · ${n.label ?? n.id}${n.surface ? ` [${n.surface}]` : ''}`))
      })
  }, [])

  useEffect(() => { loadRecent().catch(() => { /* agent-machine not running */ }) }, [graph.nodeCount, loadRecent])
  const healthCheck = useAsyncAction()
  const refresh = useAsyncAction()
  const exportSnap = useAsyncAction()

  const topMetrics = [
    { label: 'Nodes indexed',      value: graph.nodeCount       || '—', sub: graph.status === 'unknown' ? 'Not connected' : undefined },
    { label: 'Edges indexed',      value: graph.edgeCount       || '—' },
    { label: 'Pending ingest',     value: graph.pendingIngestCount },
    { label: 'Failed ingest',      value: graph.failedIngestCount, accent: graph.failedIngestCount > 0 },
    { label: 'Orphan nodes',       value: graph.orphanNodeCount },
    { label: 'Duplicate entities', value: graph.duplicateEntityCount },
    { label: 'Stale partitions',   value: graph.stalePartitionCount },
    { label: 'Vector index',       value: graph.vectorIndexStatus, sub: graph.vectorIndexStatus },
  ] as { label: string; value: string | number; sub?: string; accent?: boolean }[]

  const actions: { label: string; run: () => void }[] = [
    { label: healthCheck.state === 'running' ? 'Checking…' : healthCheck.state === 'done' ? (healthMsg || 'Healthy ✓') : healthCheck.state === 'error' ? 'Unreachable' : 'Run health check',
      run: () => void healthCheck.run(async () => {
        const r = await fetch(amUrl('/api/status'), { signal: AbortSignal.timeout(5000) })
        if (!r.ok) throw new Error(`status ${r.status}`)
        const s = await r.json().catch(() => ({} as Record<string, unknown>))
        setHealthMsg(s && typeof s['status'] === 'string' ? `Healthy · ${s['status']}` : 'Healthy ✓')
      }) },
    { label: refresh.state === 'running' ? 'Refreshing…' : refresh.state === 'done' ? 'Refreshed ✓' : refresh.state === 'error' ? 'Failed' : 'Refresh graph',
      run: () => void refresh.run(async () => { onRefresh?.(); await loadRecent() }) },
    { label: exportSnap.state === 'running' ? 'Exporting…' : exportSnap.state === 'done' ? 'Exported ✓' : exportSnap.state === 'error' ? 'Export failed' : 'Export snapshot',
      run: () => void exportSnap.run(exportGraphSnapshot) },
    { label: 'Open replay view',   run: () => onTabChange('Time Service') },
    { label: 'Open event ledger',  run: () => onTabChange('Event Ledger') },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {topMetrics.map(({ label, value, sub, accent }) => (
          <StatCard key={label} label={label} value={value} sub={sub} accent={accent} />
        ))}
      </div>

      <GraphViz onNodeClick={onAtomSelect ? (n) => onAtomSelect(`Explore the knowledge graph for "${n.surface || n.label}" — what entities, relationships, and insights connect to this atom?`) : undefined} />

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
        <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
          <SectionHeader title="Indexing timeline" />
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border-tertiary)] px-0">
          {[
            { label: 'Last indexed',   value: graph.lastIndexedAt  ?? '—' },
            { label: 'Last reasoned',  value: graph.lastReasonedAt ?? '—' },
            { label: 'Last snapshot',  value: graph.lastSnapshotAt ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="px-5 py-4">
              <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
        <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
          <SectionHeader
            title="Recent graph events"
            action={
              <button
                onClick={() => onTabChange('Event Ledger')}
                className="rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-primary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]">
                Open event ledger
              </button>
            }
          />
        </div>
        {recentEvents.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
            No graph events. Configure Sociosphere Graph endpoint in Settings → Runtime.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border-tertiary)]">
            {recentEvents.map((e) => (
              <li key={e} className="px-5 py-3 text-xs text-[var(--color-text-primary)]">{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
        <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
          <SectionHeader title="Stale graph partitions" />
        </div>
        {stalePartitions.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-[var(--color-text-tertiary)]">No stale partitions detected.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border-tertiary)]">
            {stalePartitions.map((p) => (
              <li key={p} className="px-5 py-3 text-xs text-[var(--color-text-primary)]">{p}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {actions.map(({ label, run }) => (
          <button key={label} onClick={run}
            className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] shadow-sm transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]">
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Time Service tab ─────────────────────────────────────────────────────────

function TimeServiceTab({ time, timeServiceEndpoint }: { time: TimeServiceStatus; timeServiceEndpoint?: string }) {
  const [replayStart, setReplayStart] = useState('')
  const [replayEnd, setReplayEnd] = useState('')
  const [replayStatus, setReplayStatus] = useState<'idle' | 'requesting' | 'done' | 'error'>('idle')
  const tsEnabled = !!(timeServiceEndpoint?.trim())

  async function requestReplay() {
    if (!tsEnabled || !replayStart || !replayEnd) return
    setReplayStatus('requesting')
    try {
      const ep = timeServiceEndpoint!.replace(/\/$/, '')
      const res = await fetch(`${ep}/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ window_start: replayStart, window_end: replayEnd }),
        signal: AbortSignal.timeout(10000),
      })
      setReplayStatus(res.ok ? 'done' : 'error')
    } catch {
      setReplayStatus('error')
    }
    setTimeout(() => setReplayStatus('idle'), 3000)
  }

  async function exportCheckpoint() {
    if (!tsEnabled) return
    try {
      const ep = timeServiceEndpoint!.replace(/\/$/, '')
      const res = await fetch(`${ep}/checkpoint`, { method: 'POST', signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `checkpoint-${Date.now()}.json`; a.click()
        URL.revokeObjectURL(url)
      }
    } catch { /* best-effort */ }
  }
  const metrics = [
    { label: 'Logical time',    value: time.logicalTime,                         sub: time.status },
    { label: 'Latest event',    value: time.latestEventTime },
    { label: 'Ledger lag',      value: time.ledgerLagMs === 0 ? '—' : `${time.ledgerLagMs} ms`,   accent: time.ledgerLagMs > 500 },
    { label: 'Clock skew',      value: time.clockSkewMs  === 0 ? '—' : `${time.clockSkewMs} ms`,  accent: time.clockSkewMs  > 100 },
    { label: 'Last checkpoint', value: time.lastCheckpointAt  ?? '—' },
    { label: 'Replay start',    value: time.replayWindowStart ?? '—' },
    { label: 'Replay end',      value: time.replayWindowEnd   ?? '—' },
  ] as { label: string; value: string | number; sub?: string; accent?: boolean }[]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {metrics.map(({ label, value, sub, accent }) => (
          <StatCard key={label} label={label} value={value} sub={sub} accent={accent} />
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
        <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
          <SectionHeader title="Replay window controls" />
        </div>
        <div className="px-5 py-5 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[var(--color-text-secondary)]">Window start</label>
              <input
                type="datetime-local"
                disabled={!tsEnabled}
                value={replayStart}
                onChange={(e) => setReplayStart(e.target.value)}
                placeholder="—"
                className={`w-full rounded-xl border px-3 py-2 text-xs outline-none ${tsEnabled ? 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] focus:border-[#1d4ed8]' : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] cursor-not-allowed'}`} />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[var(--color-text-secondary)]">Window end</label>
              <input
                type="datetime-local"
                disabled={!tsEnabled}
                value={replayEnd}
                onChange={(e) => setReplayEnd(e.target.value)}
                placeholder="—"
                className={`w-full rounded-xl border px-3 py-2 text-xs outline-none ${tsEnabled ? 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] focus:border-[#1d4ed8]' : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] cursor-not-allowed'}`} />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              disabled={!tsEnabled || !replayStart || !replayEnd || replayStatus === 'requesting'}
              onClick={() => void requestReplay()}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${tsEnabled && replayStart && replayEnd ? 'border-[#1d4ed8] bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe]' : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] cursor-not-allowed'} disabled:opacity-60`}>
              {replayStatus === 'requesting' ? 'Requesting…' : replayStatus === 'done' ? 'Requested ✓' : replayStatus === 'error' ? 'Error ✗' : 'Request replay'}
            </button>
            <button
              disabled={!tsEnabled}
              onClick={() => void exportCheckpoint()}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${tsEnabled ? 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:border-[#1d4ed8] hover:text-[#1d4ed8]' : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] cursor-not-allowed'}`}>
              Export checkpoint
            </button>
          </div>
          {!tsEnabled && (
            <p className="text-[10px] text-[var(--color-text-tertiary)]">Configure Time Service endpoint in Settings → Runtime to enable replay.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Connector Health tab ─────────────────────────────────────────────────────

function capToHealth(cap: NoeticaServiceCapabilityStatus | undefined): HealthStatus {
  if (!cap) return 'unknown'
  if (cap === 'ready') return 'healthy'
  if (cap === 'error') return 'failed'
  return 'unknown'
}

function capToDetail(cap: NoeticaServiceCapabilityStatus | undefined, readyLabel: string): string {
  if (!cap) return 'Not loaded'
  if (cap === 'ready') return readyLabel
  if (cap === 'error') return 'Error'
  if (cap === 'not_configured') return 'Not configured'
  if (cap === 'disabled') return 'Disabled'
  if (cap === 'deferred') return 'Deferred'
  return 'Unknown'
}

function ConnectorHealthTab({ noeticaStatus, statusLoading }: { noeticaStatus: NoeticaServiceStatus | null; statusLoading: boolean }) {
  const { store } = useConnectorAuth()

  const matrixAuth = store.matrix
  const googleAuth = store.google
  const githubAuth = store.github

  function authHealth(status: string | undefined): HealthStatus {
    if (status === 'connected') return 'healthy'
    if (status === 'connecting') return 'degraded'
    if (status === 'error') return 'failed'
    return 'unknown'
  }
  function authDetail(status: string | undefined, userLabel?: string): string {
    if (status === 'connected') return userLabel ?? 'Connected'
    if (status === 'connecting') return 'Connecting…'
    if (status === 'error') return 'Auth error'
    return 'Not connected — Settings → Connections'
  }

  const connectors: { label: string; status: HealthStatus; detail: string }[] = [
    {
      label:  'SourceOS',
      status: statusLoading ? 'unknown' : capToHealth(noeticaStatus?.sourceos_route),
      detail: statusLoading ? 'Loading…' : capToDetail(noeticaStatus?.sourceos_route, 'Route active'),
    },
    {
      label:  'Gitea Sovereign',
      status: 'unknown',
      detail: 'Not configured',
    },
    {
      label:  'Prophet Mail / Gmail',
      status: authHealth(googleAuth?.status),
      detail: authDetail(googleAuth?.status, googleAuth?.userInfo?.email ?? 'Google connected'),
    },
    {
      label:  'Sociosphere Graph',
      status: statusLoading ? 'unknown' : capToHealth(noeticaStatus?.prophet_mesh),
      detail: statusLoading ? 'Loading…' : capToDetail(noeticaStatus?.prophet_mesh, 'Mesh active'),
    },
    {
      label:  'Matrix',
      status: authHealth(matrixAuth?.status),
      detail: authDetail(matrixAuth?.status, (matrixAuth as { userId?: string } | undefined)?.userId ?? 'Matrix connected'),
    },
    {
      label:  'Agent Registry',
      status: statusLoading ? 'unknown' : capToHealth(noeticaStatus?.agent_machine),
      detail: statusLoading ? 'Loading…' : capToDetail(noeticaStatus?.agent_machine, 'Agent machine active'),
    },
    {
      label:  'GitHub',
      status: authHealth(githubAuth?.status),
      detail: authDetail(githubAuth?.status, githubAuth?.userInfo?.login ? `@${githubAuth.userInfo.login}` : 'GitHub connected'),
    },
  ]

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm">
      <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
        <SectionHeader title="Connector health" />
      </div>
      <div className="divide-y divide-[var(--color-border-tertiary)]">
        {connectors.map(({ label, status, detail }) => (
          <div key={label} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2.5">
              <StatusDot status={status} />
              <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">{detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sync Queues tab ──────────────────────────────────────────────────────────

const CONNECTOR_META: { id: string; label: string; color: string }[] = [
  { id: 'google',  label: 'Google (Gmail + Calendar)', color: '#4285F4' },
  { id: 'github',  label: 'GitHub',                    color: '#24292e' },
  { id: 'slack',   label: 'Slack',                     color: '#4A154B' },
  { id: 'linear',  label: 'Linear',                    color: '#5E6AD2' },
  { id: 'notion',  label: 'Notion',                    color: '#000000' },
  { id: 'matrix',  label: 'Matrix',                    color: '#0DBD8B' },
]

function connectorHealth(status: string | undefined): HealthStatus {
  if (status === 'connected') return 'healthy'
  if (status === 'error') return 'failed'
  if (status === 'connecting') return 'degraded'
  return 'unknown'
}

function SyncQueuesTab() {
  const { store } = useConnectorAuth()
  const now = Date.now()

  const rows = CONNECTOR_META.map(({ id, label, color }) => {
    const auth = store[id as keyof typeof store]
    const health = connectorHealth(auth?.status)
    const connectedAt = auth?.connectedAt ? new Date(auth.connectedAt) : null
    const ageMs = connectedAt ? now - connectedAt.getTime() : null
    const ageLabel = ageMs == null ? '—'
      : ageMs < 60_000 ? 'just now'
      : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago`
      : ageMs < 86_400_000 ? `${Math.floor(ageMs / 3_600_000)}h ago`
      : `${Math.floor(ageMs / 86_400_000)}d ago`

    return { id, label, color, health, auth, connectedAt, ageLabel }
  })

  const connected = rows.filter((r) => r.health === 'healthy').length
  const total = rows.length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active syncs" value={connected} sub={`of ${total} connectors`} accent={connected > 0} />
        <StatCard label="Errored" value={rows.filter((r) => r.health === 'failed').length} />
        <StatCard label="Disconnected" value={rows.filter((r) => r.health === 'unknown').length} />
      </div>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm overflow-hidden">
        <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
          <SectionHeader title="Connector sync state" />
        </div>
        <div className="divide-y divide-[var(--color-border-tertiary)]">
          {rows.map(({ id, label, color, health, auth, ageLabel }) => (
            <div key={id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                style={{ background: color }}>
                {label[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusDot status={health} />
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
                </div>
                {auth?.userInfo?.name && (
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">{auth.userInfo.name}</p>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold capitalize text-[var(--color-text-secondary)]">
                  {auth?.status ?? 'disconnected'}
                </div>
                <div className="text-[10px] text-[var(--color-text-tertiary)]">{ageLabel}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-5 py-2.5 text-[10px] text-[var(--color-text-tertiary)]">
          Connector sync state derived from local auth store. SourceOS substrate will add queue depth and processing rates.
        </div>
      </div>
    </div>
  )
}

// ─── Event Ledger tab ─────────────────────────────────────────────────────────

type LedgerEvent = { id: string; ts: number; kind: string; subject: string; detail: string; level: 'info' | 'warn' | 'error' }

function buildLedger(store: ReturnType<typeof useConnectorAuth>['store']): LedgerEvent[] {
  const events: LedgerEvent[] = []
  for (const { id, label } of CONNECTOR_META) {
    const auth = store[id as keyof typeof store]
    if (!auth) continue
    if (auth.connectedAt) {
      events.push({
        id: `${id}-connected`,
        ts: new Date(auth.connectedAt).getTime(),
        kind: 'auth',
        subject: label,
        detail: `Connected${auth.userInfo?.name ? ` as ${auth.userInfo.name}` : ''}`,
        level: 'info',
      })
    }
    if (auth.status === 'error' && auth.error) {
      events.push({
        id: `${id}-error`,
        ts: auth.connectedAt ? new Date(auth.connectedAt).getTime() + 1 : Date.now(),
        kind: 'error',
        subject: label,
        detail: auth.error,
        level: 'error',
      })
    }
  }
  return events.sort((a, b) => b.ts - a.ts)
}

function fmtTs(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function EventLedgerTab() {
  const { store } = useConnectorAuth()
  const events = buildLedger(store)

  const levelColor: Record<LedgerEvent['level'], string> = {
    info:  'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
    warn:  'bg-[var(--color-attention-bg)] text-[var(--color-attention)]',
    error: 'bg-[#fef2f2] text-[#dc2626]',
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm overflow-hidden">
      <div className="border-b border-[var(--color-border-tertiary)] px-5 py-3">
        <SectionHeader title="Event ledger" action={
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{events.length} event{events.length !== 1 ? 's' : ''}</span>
        } />
      </div>
      {events.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--color-text-tertiary)]">
          No events yet. Events will appear here as connectors authenticate and sync.
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border-tertiary)]">
          {events.map((evt) => (
            <div key={evt.id} className="flex items-start gap-3 px-5 py-3">
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelColor[evt.level]}`}>
                {evt.kind}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--color-text-primary)]">{evt.subject}</div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">{evt.detail}</div>
              </div>
              <div className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{fmtTs(evt.ts)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-5 py-2.5 text-[10px] text-[var(--color-text-tertiary)]">
        Browser-local auth events. SourceOS substrate will add durable, ordered ledger entries.
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

const VIEW_TABS = ['Graph Health', 'Time Service', 'Connector Health', 'Sync Queues', 'Event Ledger'] as const
type ViewTab = typeof VIEW_TABS[number]

export function OperateSurface({ onAtomSelect }: { onAtomSelect?: (query: string) => void } = {}) {
  const [tab, setTab] = useState<ViewTab>('Graph Health')
  const { settings } = useSettings()
  const healthCheck = useHealthCheck(amUrl('/api/status'))
  const exportSnap = useAsyncAction()

  // Live HellGraph health — falls back to the unknown stub until first fetch.
  const [graph, setGraph] = useState<GraphHealthStatus>(STUB_GRAPH)
  const [time, setTime]   = useState<TimeServiceStatus>(STUB_TIME)

  const [noeticaStatus, setNoeticaStatus] = useState<NoeticaServiceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => {
    loadNoeticaStatus()
      .then((s) => { setNoeticaStatus(s); setStatusLoading(false) })
      .catch(() => setStatusLoading(false))
  }, [])

  // Reusable so the "Refresh graph" button can force an on-demand refetch (not just the 5s poll).
  const refreshHealth = useCallback(() => {
    return fetch(amUrl('/api/graph/health'))
      .then((r) => r.ok ? r.json() : null)
      .then((data: { graph?: GraphHealthStatus; time?: TimeServiceStatus } | null) => {
        if (!data) return
        if (data.graph) setGraph(data.graph)
        if (data.time) setTime(data.time)
      })
      .catch(() => { /* keep last-known/stub */ })
  }, [])

  useEffect(() => {
    void refreshHealth()
    const interval = setInterval(() => void refreshHealth(), 5000)
    return () => clearInterval(interval)
  }, [refreshHealth])

  const topCards: { label: string; status: HealthStatus; detail: string }[] = [
    { label: 'Sociosphere Graph', status: graph.status, detail: graph.status === 'unknown' ? 'Not connected' : `${graph.nodeCount} nodes` },
    { label: 'Time Service',      status: time.status,  detail: time.status  === 'unknown' ? 'Not configured' : time.logicalTime },
    {
      label:  'SourceOS',
      status: statusLoading ? 'unknown' : capToHealth(noeticaStatus?.sourceos_route),
      detail: statusLoading ? 'Loading…' : capToDetail(noeticaStatus?.sourceos_route, 'Route active'),
    },
    {
      label:  'Agent Mesh',
      status: statusLoading ? 'unknown' : capToHealth(noeticaStatus?.agent_machine),
      detail: statusLoading ? 'Loading…' : capToDetail(noeticaStatus?.agent_machine, 'Agent machine active'),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-[var(--color-text-primary)]">Operational Intelligence</div>
            <div className="text-xs text-[var(--color-text-secondary)]">Sociosphere graph health, time service, SourceOS substrate, connector health, event ledger.</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={healthCheck.trigger}
              className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]">
              {healthCheck.state === 'running' ? 'Checking…' : healthCheck.state === 'done' ? `All clear · ${healthCheck.result?.latency_ms ?? 0}ms` : healthCheck.state === 'failed' ? `Failed · ${healthCheck.result?.detail ?? 'error'}` : 'Run health check'}
            </button>
            <button
              onClick={() => void exportSnap.run(async () => {
                // Real export: download the live operational snapshot (graph + time + service status) as JSON.
                const snap = { exportedAt: new Date().toISOString(), graph, time, noetica: noeticaStatus }
                const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
                a.download = `noetica-operate-snapshot-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href)
              })}
              className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
              {exportSnap.state === 'running' ? 'Exporting…' : exportSnap.state === 'done' ? 'Exported ✓' : exportSnap.state === 'error' ? 'Export failed' : 'Export snapshot'}
            </button>
          </div>
        </div>

        {/* Status row */}
        <div className="grid grid-cols-4 gap-3">
          {topCards.map(({ label, status, detail }) => (
            <div key={label} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <StatusDot status={status} />
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">{label}</span>
              </div>
              <div className="mt-2 text-xs text-[var(--color-text-secondary)]">{detail}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-1 w-fit">
          {VIEW_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === t
                  ? 'bg-[var(--color-background-primary)] shadow-sm text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'Graph Health'     && <GraphHealthTab    graph={graph} onTabChange={setTab} onAtomSelect={onAtomSelect} onRefresh={refreshHealth} />}
        {tab === 'Time Service'     && <TimeServiceTab    time={time}   timeServiceEndpoint={settings.timeServiceEndpoint}  />}
        {tab === 'Connector Health' && <ConnectorHealthTab noeticaStatus={noeticaStatus} statusLoading={statusLoading} />}
        {tab === 'Sync Queues'      && <SyncQueuesTab />}
        {tab === 'Event Ledger'     && <EventLedgerTab />}
      </div>
    </div>
  )
}

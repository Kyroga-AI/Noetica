'use client'

import { useEffect, useState } from 'react'
import type { GraphHealthStatus, TimeServiceStatus } from '@/lib/types/graph'
import type { NoeticaServiceStatus, NoeticaServiceCapabilityStatus } from '@/lib/contracts/noeticaService'
import { loadNoeticaStatus } from '@/lib/client/noeticaStatus'
import { useConnectorAuth } from '@/lib/auth/context'

type HealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown'

function StatusDot({ status }: { status: HealthStatus }) {
  const colors: Record<HealthStatus, string> = {
    healthy:  'bg-[#22c55e]',
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

function useFlash() {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  function trigger() {
    setState('running')
    setTimeout(() => { setState('done'); setTimeout(() => setState('idle'), 1000) }, 1400)
  }
  return { state, trigger }
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

function GraphHealthTab({ graph, onTabChange }: { graph: GraphHealthStatus; onTabChange: (tab: ViewTab) => void }) {
  const recentEvents: string[] = []
  const stalePartitions: string[] = []
  const healthCheck = useFlash()
  const refresh = useFlash()
  const exportSnap = useFlash()

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
    { label: healthCheck.state === 'running' ? 'Checking…' : healthCheck.state === 'done' ? 'All clear' : 'Run health check',
      run: healthCheck.trigger },
    { label: refresh.state === 'running' ? 'Refreshing…' : refresh.state === 'done' ? 'Refreshed' : 'Refresh graph',
      run: refresh.trigger },
    { label: exportSnap.state === 'running' ? 'Exporting…' : exportSnap.state === 'done' ? 'Exported' : 'Export snapshot',
      run: exportSnap.trigger },
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

function TimeServiceTab({ time }: { time: TimeServiceStatus }) {
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
              <input disabled placeholder="—"
                className="w-full rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-tertiary)] cursor-not-allowed" />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[var(--color-text-secondary)]">Window end</label>
              <input disabled placeholder="—"
                className="w-full rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-tertiary)] cursor-not-allowed" />
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled
              className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs font-semibold text-[var(--color-text-tertiary)] cursor-not-allowed">
              Open replay view
            </button>
            <button disabled
              className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs font-semibold text-[var(--color-text-tertiary)] cursor-not-allowed">
              Export checkpoint
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">Configure Time Service endpoint in Settings → Runtime to enable replay.</p>
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
    info:  'bg-[#dcfce7] text-[#16a34a]',
    warn:  'bg-[#fef9c3] text-[#92400e]',
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

export function OperateSurface() {
  const [tab, setTab] = useState<ViewTab>('Graph Health')
  const healthCheck = useHealthCheck(amUrl('/api/status'))
  const exportSnap = useFlash()

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

  useEffect(() => {
    let active = true
    const fetchHealth = () => {
      fetch(amUrl('/api/graph/health'))
        .then((r) => r.ok ? r.json() : null)
        .then((data: { graph?: GraphHealthStatus; time?: TimeServiceStatus } | null) => {
          if (!active || !data) return
          if (data.graph) setGraph(data.graph)
          if (data.time) setTime(data.time)
        })
        .catch(() => { /* keep last-known/stub */ })
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, 5000)
    return () => { active = false; clearInterval(interval) }
  }, [])

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
              onClick={exportSnap.trigger}
              className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
              {exportSnap.state === 'running' ? 'Exporting…' : exportSnap.state === 'done' ? 'Exported' : 'Export snapshot'}
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
        {tab === 'Graph Health'     && <GraphHealthTab    graph={graph} onTabChange={setTab} />}
        {tab === 'Time Service'     && <TimeServiceTab    time={time}   />}
        {tab === 'Connector Health' && <ConnectorHealthTab noeticaStatus={noeticaStatus} statusLoading={statusLoading} />}
        {tab === 'Sync Queues'      && <SyncQueuesTab />}
        {tab === 'Event Ledger'     && <EventLedgerTab />}
      </div>
    </div>
  )
}

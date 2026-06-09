'use client'

import { useState } from 'react'
import type { GraphHealthStatus, TimeServiceStatus } from '@/lib/types/graph'

type HealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown'

function StatusDot({ status }: { status: HealthStatus }) {
  const colors: Record<HealthStatus, string> = {
    healthy:  'bg-[#22c55e]',
    degraded: 'bg-[#f59e0b]',
    failed:   'bg-[#ef4444]',
    unknown:  'bg-[#94a3b8]',
  }
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[#d7dee8] bg-white'}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent ? 'text-[#1d4ed8]' : 'text-[#0f172a]'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[#64748b]">{sub}</div>}
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

function GraphHealthTab({ graph }: { graph: GraphHealthStatus }) {
  const recentEvents: string[] = []
  const stalePartitions: string[] = []

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

  return (
    <div className="space-y-5">
      {/* Metric grid */}
      <div className="grid grid-cols-4 gap-3">
        {topMetrics.map(({ label, value, sub, accent }) => (
          <StatCard key={label} label={label} value={value} sub={sub} accent={accent} />
        ))}
      </div>

      {/* Timestamps */}
      <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-5 py-3">
          <SectionHeader title="Indexing timeline" />
        </div>
        <div className="grid grid-cols-3 divide-x divide-[#f1f5f9] px-0">
          {[
            { label: 'Last indexed',    value: graph.lastIndexedAt   ?? '—' },
            { label: 'Last reasoned',   value: graph.lastReasonedAt  ?? '—' },
            { label: 'Last snapshot',   value: graph.lastSnapshotAt  ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="px-5 py-4">
              <div className="text-xs text-[#94a3b8]">{label}</div>
              <div className="mt-1 text-sm font-semibold text-[#334155]">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent graph events */}
      <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-5 py-3">
          <SectionHeader
            title="Recent graph events"
            action={
              <button className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1 text-xs font-medium text-[#334155] transition hover:bg-white">
                Open event ledger
              </button>
            }
          />
        </div>
        {recentEvents.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[#94a3b8]">
            No graph events. Configure Sociosphere Graph endpoint in Settings → Runtime.
          </div>
        ) : (
          <ul className="divide-y divide-[#f1f5f9]">
            {recentEvents.map((e) => (
              <li key={e} className="px-5 py-3 text-xs text-[#334155]">{e}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Stale partitions */}
      <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-5 py-3">
          <SectionHeader title="Stale graph partitions" />
        </div>
        {stalePartitions.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-[#94a3b8]">No stale partitions detected.</div>
        ) : (
          <ul className="divide-y divide-[#f1f5f9]">
            {stalePartitions.map((p) => (
              <li key={p} className="px-5 py-3 text-xs text-[#334155]">{p}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {['Run health check', 'Refresh graph', 'Export snapshot', 'Open graph explorer', 'Open replay view'].map((a) => (
          <button key={a} className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#334155] shadow-sm transition hover:bg-[#f8fafc]">
            {a}
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
    { label: 'Last checkpoint', value: time.lastCheckpointAt   ?? '—' },
    { label: 'Replay start',    value: time.replayWindowStart  ?? '—' },
    { label: 'Replay end',      value: time.replayWindowEnd    ?? '—' },
  ] as { label: string; value: string | number; sub?: string; accent?: boolean }[]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {metrics.map(({ label, value, sub, accent }) => (
          <StatCard key={label} label={label} value={value} sub={sub} accent={accent} />
        ))}
      </div>

      <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-5 py-3">
          <SectionHeader title="Replay window controls" />
        </div>
        <div className="px-5 py-5 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[#64748b]">Window start</label>
              <input disabled placeholder="—" className="w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#94a3b8]" />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[#64748b]">Window end</label>
              <input disabled placeholder="—" className="w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#94a3b8]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs font-semibold text-[#94a3b8] cursor-not-allowed">
              Open replay view
            </button>
            <button disabled className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs font-semibold text-[#94a3b8] cursor-not-allowed">
              Export checkpoint
            </button>
          </div>
          <p className="text-[10px] text-[#94a3b8]">Configure Time Service endpoint in Settings → Runtime to enable replay.</p>
        </div>
      </div>
    </div>
  )
}

// ─── Connector Health tab ────────────────────────────────────────────────────

function ConnectorHealthTab() {
  const connectors = [
    { label: 'SourceOS',         status: 'unknown' as HealthStatus, detail: 'Standalone mode' },
    { label: 'Gitea Sovereign',  status: 'unknown' as HealthStatus, detail: 'Not configured' },
    { label: 'Prophet Mail',     status: 'unknown' as HealthStatus, detail: 'Not configured' },
    { label: 'Sociosphere Graph',status: 'unknown' as HealthStatus, detail: 'Not configured' },
    { label: 'Matrix',           status: 'unknown' as HealthStatus, detail: 'Not configured' },
    { label: 'Agent Registry',   status: 'unknown' as HealthStatus, detail: 'Not configured' },
  ]
  return (
    <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
      <div className="border-b border-[#e2e8f0] px-5 py-3">
        <SectionHeader title="Connector health" />
      </div>
      <div className="divide-y divide-[#f1f5f9]">
        {connectors.map(({ label, status, detail }) => (
          <div key={label} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2.5">
              <StatusDot status={status} />
              <span className="text-sm text-[#334155]">{label}</span>
            </div>
            <span className="text-xs text-[#94a3b8]">{detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sync Queues tab ─────────────────────────────────────────────────────────

function SyncQueuesTab() {
  return (
    <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
      <div className="border-b border-[#e2e8f0] px-5 py-3">
        <SectionHeader title="Sync queues" />
      </div>
      <div className="px-5 py-10 text-center text-sm text-[#94a3b8]">
        Sync queue data will populate once SourceOS substrate is connected.
      </div>
    </div>
  )
}

// ─── Event Ledger tab ────────────────────────────────────────────────────────

function EventLedgerTab() {
  return (
    <div className="rounded-2xl border border-[#d7dee8] bg-white shadow-sm">
      <div className="border-b border-[#e2e8f0] px-5 py-3">
        <SectionHeader title="Event ledger" />
      </div>
      <div className="px-5 py-10 text-center text-sm text-[#94a3b8]">
        Event ledger will populate once SourceOS substrate is connected.
      </div>
    </div>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────

const VIEW_TABS = ['Graph Health', 'Time Service', 'Connector Health', 'Sync Queues', 'Event Ledger'] as const
type ViewTab = typeof VIEW_TABS[number]

export function OperateSurface() {
  const [tab, setTab] = useState<ViewTab>('Graph Health')
  const graph = STUB_GRAPH
  const time  = STUB_TIME

  const topCards: { label: string; status: HealthStatus; detail: string }[] = [
    { label: 'Sociosphere Graph', status: graph.status, detail: graph.status === 'unknown' ? 'Not connected' : `${graph.nodeCount} nodes` },
    { label: 'Time Service',      status: time.status,  detail: time.status  === 'unknown' ? 'Not configured' : time.logicalTime },
    { label: 'SourceOS',          status: 'unknown',    detail: 'Standalone mode' },
    { label: 'Agent Mesh',        status: 'unknown',    detail: 'No agents registered' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-[#0f172a]">Operational Intelligence</div>
            <div className="text-xs text-[#64748b]">Sociosphere graph health, time service, SourceOS substrate, connector health, event ledger.</div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#334155] transition hover:bg-[#f8fafc]">
              Run health check
            </button>
            <button className="rounded-xl bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e293b]">
              Export snapshot
            </button>
          </div>
        </div>

        {/* Status row */}
        <div className="grid grid-cols-4 gap-3">
          {topCards.map(({ label, status, detail }) => (
            <div key={label} className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <StatusDot status={status} />
                <span className="text-xs font-semibold text-[#0f172a]">{label}</span>
              </div>
              <div className="mt-2 text-xs text-[#64748b]">{detail}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-1 w-fit">
          {VIEW_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === t ? 'bg-white shadow-sm text-[#0f172a]' : 'text-[#64748b] hover:text-[#0f172a]'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'Graph Health'      && <GraphHealthTab    graph={graph} />}
        {tab === 'Time Service'      && <TimeServiceTab    time={time}   />}
        {tab === 'Connector Health'  && <ConnectorHealthTab />}
        {tab === 'Sync Queues'       && <SyncQueuesTab />}
        {tab === 'Event Ledger'      && <EventLedgerTab />}
      </div>
    </div>
  )
}

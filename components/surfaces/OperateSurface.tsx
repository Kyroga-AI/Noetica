'use client'

import { useState } from 'react'

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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">{label}</div>
      <div className="mt-2 text-2xl font-bold text-[#0f172a]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[#64748b]">{sub}</div>}
    </div>
  )
}

const VIEW_TABS = ['Graph Health', 'Time Service', 'Connector Health', 'Sync Queues', 'Event Ledger']

export function OperateSurface() {
  const [tab, setTab] = useState('Graph Health')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-5xl space-y-4">
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

        {/* Top status row */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusDot status="unknown" />
              <span className="text-xs font-semibold text-[#0f172a]">Sociosphere Graph</span>
            </div>
            <div className="mt-2 text-xs text-[#64748b]">Not connected</div>
          </div>
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusDot status="unknown" />
              <span className="text-xs font-semibold text-[#0f172a]">Time Service</span>
            </div>
            <div className="mt-2 text-xs text-[#64748b]">Not configured</div>
          </div>
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusDot status="unknown" />
              <span className="text-xs font-semibold text-[#0f172a]">SourceOS</span>
            </div>
            <div className="mt-2 text-xs text-[#64748b]">Standalone mode</div>
          </div>
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusDot status="unknown" />
              <span className="text-xs font-semibold text-[#0f172a]">Agent Mesh</span>
            </div>
            <div className="mt-2 text-xs text-[#64748b]">No agents registered</div>
          </div>
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
        {tab === 'Graph Health' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Nodes indexed"     value="—" sub="Not connected" />
              <StatCard label="Edges indexed"     value="—" sub="Not connected" />
              <StatCard label="Pending ingest"    value="—" />
              <StatCard label="Failed ingest"     value="—" />
              <StatCard label="Orphan nodes"      value="—" />
              <StatCard label="Duplicate entities" value="—" />
              <StatCard label="Stale partitions"  value="—" />
              <StatCard label="Vector index"      value="—" sub="unknown" />
            </div>
            <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Recent graph events</div>
              <div className="mt-4 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-8 text-center text-sm text-[#94a3b8]">
                No graph events. Configure Sociosphere Graph endpoint in Runtime settings to begin.
              </div>
            </div>
          </div>
        )}

        {tab === 'Time Service' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Logical time"    value="—" sub="Not running" />
              <StatCard label="Ledger lag"      value="—" sub="ms" />
              <StatCard label="Clock skew"      value="—" sub="ms" />
              <StatCard label="Last checkpoint" value="—" />
              <StatCard label="Replay window"   value="—" />
              <StatCard label="Latest event"    value="—" />
            </div>
          </div>
        )}

        {(tab === 'Connector Health' || tab === 'Sync Queues' || tab === 'Event Ledger') && (
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
            <div className="mt-4 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-10 text-center text-sm text-[#94a3b8]">
              {tab} data will populate once SourceOS substrate is connected.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

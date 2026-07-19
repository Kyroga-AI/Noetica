'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * IntelligenceSurface — IFM demo hub.
 *
 * Shows the live intelligence task pipeline, causal DAG inventory, and
 * consolidated supply-chain + traffic signal summary for GYG.
 */

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

type Task = {
  id: string
  name: string
  objective: string
  owner: string
  status: 'draft' | 'running' | 'complete' | 'blocked'
  created_at: string
  completed_at?: string
  evidence?: unknown[]
}

type CausalModel = { name: string; description: string; nodes: number; treatment?: string; outcome?: string }

type SupplySummary = {
  period: string
  lfl_revision_pct: number
  confidence: number
  input_cost: { current_index: number; change_pct: number }
  availability: { full_menu_pct: number; availability_drag_on_ft: number }
  summary: string
}

type TrafficAgg = {
  total_iv_transactions: number
  lfl_index: number
  by_state: Record<string, { transactions: number; locations: number }>
}

const STATUS_COLOUR: Record<string, string> = {
  draft: '#6b7280', running: '#2563eb', complete: 'var(--color-accent)', blocked: '#dc2626',
}

function Badge({ label, colour }: { label: string; colour: string }) {
  return (
    <span style={{ background: `${colour}18`, color: colour, border: `1px solid ${colour}40` }}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
      {label}
    </span>
  )
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {sub && <p className="text-xs text-[var(--color-text-tertiary)]">{sub}</p>}
    </div>
  )
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 ${className}`}>
      {children}
    </div>
  )
}

function SignalBanner({ supply, traffic }: { supply: SupplySummary; traffic: TrafficAgg }) {
  const lfl = (traffic.lfl_index - 100).toFixed(1)
  const lflNum = traffic.lfl_index - 100
  return (
    <div className="mb-4 grid grid-cols-3 gap-3">
      <Panel>
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Network LFL (IV)</div>
        <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: lflNum >= 0 ? 'var(--color-accent)' : '#dc2626' }}>
          {lflNum >= 0 ? '+' : ''}{lfl}%
        </div>
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{traffic.total_iv_transactions.toLocaleString()} wkly txns</div>
      </Panel>
      <Panel>
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Supply Chain Revision</div>
        <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: supply.lfl_revision_pct < 0 ? '#dc2626' : 'var(--color-accent)' }}>
          {supply.lfl_revision_pct >= 0 ? '+' : ''}{supply.lfl_revision_pct.toFixed(2)}pp
        </div>
        <div className="text-[10px] text-[var(--color-text-tertiary)]">input cost {supply.input_cost.current_index.toFixed(1)} (base 100)</div>
      </Panel>
      <Panel>
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Menu Availability</div>
        <div className="mt-1 text-xl font-bold tabular-nums">
          {supply.availability.full_menu_pct.toFixed(1)}%
        </div>
        <div className="text-[10px] text-[var(--color-text-tertiary)]">full menu · ft drag {supply.availability.availability_drag_on_ft.toFixed(1)}%</div>
      </Panel>
    </div>
  )
}

function TaskList({ tasks, onRefresh }: { tasks: Task[]; onRefresh: () => void }) {
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle title="Intelligence Tasks" sub={`${tasks.length} tasks`} />
        <button onClick={onRefresh} className="rounded border border-[var(--color-border-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)]">
          Refresh
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">No tasks. Seed the demo first: <code className="text-[10px]">npx tsx scripts/seed-gyg-demo.ts</code></p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--color-border-tertiary)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{t.name}</span>
                    <Badge label={t.status} colour={STATUS_COLOUR[t.status] ?? '#6b7280'} />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-secondary)] line-clamp-2">{t.objective}</p>
                </div>
                <div className="shrink-0 text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
                  {Array.isArray(t.evidence) ? t.evidence.length : 0} steps
                </div>
              </div>
              <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                owner: {t.owner} · {new Date(t.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function CausalModels({ models }: { models: CausalModel[] }) {
  return (
    <Panel>
      <SectionTitle title="Causal Models" sub={`${models.length} DAGs registered`} />
      <div className="space-y-2">
        {models.map((m) => (
          <div key={m.name} className="rounded border border-[var(--color-border-tertiary)] p-2">
            <div className="flex items-center justify-between gap-2">
              <code className="text-[11px] font-mono font-semibold text-[var(--color-text-primary)]">{m.name}</code>
              <span className="text-[10px] tabular-nums text-[var(--color-text-tertiary)]">{m.nodes} nodes</span>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] line-clamp-2">{m.description}</p>
            {(m.treatment || m.outcome) && (
              <div className="mt-1 flex gap-3 text-[10px] text-[var(--color-text-tertiary)]">
                {m.treatment && <span>treatment: <strong>{m.treatment}</strong></span>}
                {m.outcome && <span>outcome: <strong>{m.outcome}</strong></span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

function TrafficByState({ byState }: { byState: Record<string, { transactions: number; locations: number }> }) {
  const entries = Object.entries(byState).sort((a, b) => b[1].transactions - a[1].transactions)
  const max = entries[0]?.[1].transactions ?? 1
  return (
    <Panel>
      <SectionTitle title="Foot Traffic by State" sub="IV-adjusted weekly transactions" />
      <div className="space-y-1.5">
        {entries.map(([state, data]) => (
          <div key={state} className="flex items-center gap-2">
            <div className="w-8 shrink-0 text-[11px] font-semibold text-[var(--color-text-secondary)]">{state}</div>
            <div className="relative h-4 flex-1 rounded bg-[var(--color-background-tertiary)]">
              <div style={{ width: `${(data.transactions / max) * 100}%` }}
                className="absolute h-full rounded bg-blue-500 opacity-60 transition-all duration-500" />
            </div>
            <div className="w-20 shrink-0 text-right text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
              {data.transactions.toLocaleString()} · {data.locations}s
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

export function IntelligenceSurface() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [models, setModels] = useState<CausalModel[]>([])
  const [supply, setSupply] = useState<SupplySummary | null>(null)
  const [traffic, setTraffic] = useState<TrafficAgg | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setErr('')
    const base = amUrl

    Promise.all([
      fetch(base('/api/intelligence/tasks')).then((r) => r.json() as Promise<{ tasks: Task[] }>).then((d) => setTasks(d.tasks ?? [])),
      fetch(base('/api/causal/models')).then((r) => r.json() as Promise<{ models: CausalModel[] }>).then((d) => setModels(d.models ?? [])),
      fetch(base('/api/supply-chain/signal')).then((r) => r.json() as Promise<SupplySummary>).then(setSupply),
      fetch(base('/api/location-traffic/aggregate')).then((r) => r.json() as Promise<TrafficAgg>).then(setTraffic),
    ]).catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load — is the backend running?'))
  }, [])

  useEffect(load, [load])

  if (err) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{err}</p>
          <button onClick={load} className="rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-background-primary)]">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">Intelligence Hub</h1>
            <p className="text-xs text-[var(--color-text-tertiary)]">IFM demo · GYG like-for-like signal with ASIC-defensible causal provenance</p>
          </div>
          <button onClick={load} className="shrink-0 rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
            Refresh
          </button>
        </div>
        {supply?.summary && (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">{supply.summary}</p>
        )}
      </div>

      <div className="flex-1 px-6 py-4">
        {supply && traffic && <SignalBanner supply={supply} traffic={traffic} />}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <TaskList tasks={tasks} onRefresh={load} />
            {traffic && <TrafficByState byState={traffic.by_state} />}
          </div>
          <div className="space-y-4">
            <CausalModels models={models} />
          </div>
        </div>
      </div>
    </div>
  )
}

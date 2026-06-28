'use client'

import { useEffect, useRef, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

interface IngestJob {
  id: string
  filename: string
  status: 'queued' | 'parsing' | 'ingesting' | 'done' | 'failed'
  chunks?: number
  entities?: number
  error?: string
  bytes: number
}
interface IngestStatus { jobs: IngestJob[]; summary: { queued: number; active: number; done: number; failed: number } }

const STATUS_STYLE: Record<IngestJob['status'], { label: string; color: string; spin?: boolean }> = {
  queued: { label: 'queued', color: 'var(--color-text-tertiary)' },
  parsing: { label: 'parsing', color: '#3b82f6', spin: true },
  ingesting: { label: 'ingesting', color: '#8b5cf6', spin: true },
  done: { label: 'done', color: '#10b981' },
  failed: { label: 'failed', color: '#ef4444' },
}

/**
 * Live ingestion queue — the "table of what's parsed vs pending" for bulk/zip uploads. Polls /api/ingest/status
 * while there's active work (and once whenever `refreshSignal` changes, i.e. a new upload enqueues). Shows each
 * doc's status as it lands in the graph; auto-hides when there are no jobs.
 */
export function IngestQueueTable({ refreshSignal }: { refreshSignal: number }) {
  const [status, setStatus] = useState<IngestStatus | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const r = await fetch(amUrl('/api/ingest/status'))
        if (!alive) return
        if (r.ok) {
          const s = (await r.json()) as IngestStatus
          setStatus(s)
          if (s.summary.queued + s.summary.active > 0) timer.current = setTimeout(poll, 1500)  // keep polling while busy
        }
      } catch { /* transient — stop quietly */ }
    }
    void poll()
    return () => { alive = false; if (timer.current) clearTimeout(timer.current) }
  }, [refreshSignal])

  const jobs = status?.jobs ?? []
  if (jobs.length === 0) return null
  const sum = status!.summary

  return (
    <div className="mb-2 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-2 text-[12px]">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="font-semibold text-[var(--color-text-secondary)]">Ingestion queue</span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {sum.active + sum.queued > 0 ? `${sum.active + sum.queued} in progress · ` : ''}{sum.done} done{sum.failed > 0 ? ` · ${sum.failed} failed` : ''}
        </span>
      </div>
      <div className="max-h-40 overflow-y-auto">
        {jobs.slice(0, 30).map((j) => {
          const s = STATUS_STYLE[j.status]
          return (
            <div key={j.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--color-background-tertiary)]">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color, animation: s.spin ? 'pulse 1s ease-in-out infinite' : undefined }} />
              <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]" title={j.filename}>{j.filename.split('/').pop()}</span>
              {j.status === 'done' && (
                <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{j.chunks ?? 0} chunks · {j.entities ?? 0} entities</span>
              )}
              {j.status === 'failed' && (
                <span className="shrink-0 max-w-[160px] truncate text-[10px] text-[#ef4444]" title={j.error}>{j.error}</span>
              )}
              <span className="shrink-0 text-[10px] font-medium capitalize" style={{ color: s.color }}>{s.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

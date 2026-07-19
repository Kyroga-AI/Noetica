'use client'

import { useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

interface GoalSlot { name: string; filled: boolean }
interface GoalSubtask { title: string; done: boolean }
interface Goal {
  id: string
  session_id: string
  objective: string
  status: string
  subtasks: GoalSubtask[]
  slots: GoalSlot[]
}

/**
 * Compact banner showing the session's active goal (objective, plan progress,
 * still-needed slots). Surfaces the orchestration layer so the user can see what
 * the agent is working toward across turns. Best-effort: hidden if none/offline.
 */
export function GoalBanner({ sessionId }: { sessionId?: string }) {
  const [goal, setGoal] = useState<Goal | null>(null)

  useEffect(() => {
    if (!sessionId) { setGoal(null); return }
    let cancelled = false
    const load = () => {
      fetch(amUrl(`/api/goals?session=${encodeURIComponent(sessionId)}`), { signal: AbortSignal.timeout(3000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { goals?: Goal[] } | null) => {
          if (cancelled) return
          setGoal(d?.goals?.find((g) => g.status === 'active') ?? null)
        })
        .catch(() => { /* agent-machine offline — no banner */ })
    }
    load()
    const t = setInterval(load, 15_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [sessionId])

  if (!goal) return null
  const done = goal.subtasks.filter((s) => s.done).length
  const open = goal.slots.filter((s) => !s.filled).map((s) => s.name)

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2563eb]" />
        <span className="font-medium text-[var(--color-text-secondary)]">Goal</span>
        <span className="truncate text-[var(--color-text-primary)]">{goal.objective}</span>
        {goal.subtasks.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{done}/{goal.subtasks.length} steps</span>
        )}
      </div>
      {open.length > 0 && (
        <div className="mt-1 text-[10px] text-[var(--color-attention)]">Still needed: {open.join(', ')}</div>
      )}
    </div>
  )
}

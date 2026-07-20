'use client'

import type { ExecutionPlan } from '@/lib/types/message'

/**
 * PlanChecklist — the live todo list for a turn. The agent machine streams a `plan` event
 * (ordered steps) and `step` updates (status by id); this renders them as a checklist that
 * checks off in real time, the way Claude Code / Copilot surface a task list.
 */
export function PlanChecklist({ plan }: { plan: ExecutionPlan }) {
  if (!plan?.steps?.length) return null
  const done = plan.steps.filter((s) => s.status === 'done').length
  const total = plan.steps.length

  return (
    <div className="my-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Plan</span>
        <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{done}/{total}</span>
      </div>
      <ul className="space-y-1">
        {plan.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-[11px] leading-snug">
            <span className="mt-[2px] flex h-3 w-3 shrink-0 items-center justify-center">
              {s.status === 'done' ? (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6.5l2.5 2.5L10 3.5" stroke="var(--color-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : s.status === 'running' ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-[#1d4ed8] border-t-transparent" aria-label="running" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-tertiary)]" aria-label="pending" />
              )}
            </span>
            <span className="flex-1">
              <span className={
                s.status === 'done' ? 'text-[var(--color-text-secondary)] line-through opacity-70'
                : s.status === 'running' ? 'font-medium text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)]'
              }>{s.label}</span>
              {s.detail && <span className="ml-1.5 text-[var(--color-text-tertiary)]">— {s.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

'use client'

import { useState, type ReactNode } from 'react'

export type WorkspaceTab = { id: string; label: string; render: () => ReactNode }

/**
 * TabbedWorkspace — collapses several single-panel surfaces into ONE nav destination with a tab bar.
 * The panels keep their existing components (rendered lazily per active tab); they just stop each
 * claiming a top-level sidebar slot. This is the reusable shell behind the nav-consolidation pass —
 * e.g. Studio hosts Prompt/RAG/Capabilities/Alignment; Operate hosts Operate/Computer Use.
 */
export function TabbedWorkspace({ tabs, initialTab }: { tabs: WorkspaceTab[]; initialTab?: string }) {
  const [active, setActive] = useState(initialTab ?? tabs[0]?.id)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border-secondary)] px-3 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              t.id === current?.id
                ? 'bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{current?.render()}</div>
    </div>
  )
}

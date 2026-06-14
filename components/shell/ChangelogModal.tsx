'use client'

import { useEffect } from 'react'

const CHANGELOG = [
  {
    version: '0.5.0',
    date: '2026-06-13',
    changes: [
      'UtilityRail wired into AppShell — calendar, mail, matrix, agents, sourceos, evidence, graph panels',
      'RuntimeStatus component live in Topbar — desktop mode, runtime, provider, agent, mesh readout',
      '⌘1–9 keyboard shortcuts for surface switching; shortcuts listed in CommandPalette and HelpModal',
      'fontSize (sm/md/lg) and sidebarDensity (comfortable/compact) wired to DOM via data attributes',
      'Sidebar group headers use dynamic gap via density prop; placeholder surfaces get null right panels',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-06-13',
    changes: [
      'Full dark-mode coverage: 100 CSS catch-all rules across all 50+ components',
      'GovernSurface rewrite — interactive policy mode, memory scope counters, live audit trail, evidence bundles',
      'SettingsModal, TuneSurface, ModelPicker converted to CSS variables',
      'Hover, focus, and disabled state overrides for all Tailwind modifier variants',
      'User menu: all items now functional with dedicated screens',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-12',
    changes: [
      'Claude charcoal dark theme as default with navy and light theme options',
      'Theme picker in Topbar — no-FOUC inline script prevents flash on load',
      'TuneSurface: DPO export, teacher/student model comparison, preference labelling',
      'EvaluateSurface: live benchmark runner with score matrix and result detail',
      'CoworkSurface: AI task decomposition, agent assignment, decision log',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-10',
    changes: [
      'SettingsModal: Appearance, Models, Runtime, Connectors, Memory, Fan-out, Developer panels',
      'MCP server management with SSE and stdio transport support',
      'Fan-out mode: parallel multi-model responses in one thread with recombine',
      'Voice input via Web Speech API',
      'Command palette (⌘K) with surface and action navigation',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06-08',
    changes: [
      'Initial Noetica shell: sidebar, topbar, center workspace, right rail',
      'Session management with fork, edit, and regenerate',
      'Artifact pane: text, code, and preview modes',
      'Notes surface with per-note memory scope',
      'Projects surface with kanban board and sprint view',
    ],
  },
]

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[560px] max-h-[80vh] overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Changelog</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {CHANGELOG.map((entry, entryIdx) => (
            <div key={entry.version} className="relative pl-6">
              <div className="absolute left-0 top-1 flex flex-col items-center">
                <div className={`h-2.5 w-2.5 rounded-full border-2 ${entryIdx === 0 ? 'border-[#1d4ed8] bg-[#1d4ed8]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]'}`} />
                {entryIdx < CHANGELOG.length - 1 && (
                  <div className="mt-1 w-px flex-1 bg-[var(--color-border-tertiary)]" style={{ height: '100%', minHeight: 40 }} />
                )}
              </div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="font-mono text-xs font-semibold text-[#1d4ed8]">v{entry.version}</span>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{entry.date}</span>
                {entryIdx === 0 && (
                  <span className="rounded bg-[rgba(29,78,216,0.12)] px-1.5 py-0.5 text-[9px] font-semibold text-[#1d4ed8]">Latest</span>
                )}
              </div>
              <ul className="space-y-1.5">
                {entry.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect } from 'react'

const SHORTCUTS = [
  { keys: '⌘K',  desc: 'Command palette' },
  { keys: '⌘,',  desc: 'Open settings' },
  { keys: '⌘N',  desc: 'New chat' },
  { keys: '⌘\\', desc: 'Toggle sidebar' },
  { keys: '⌘I',  desc: 'Toggle inspector' },
  { keys: 'Esc', desc: 'Close modal / palette' },
]

export function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[480px] max-h-[85vh] overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Help & keyboard shortcuts</h2>
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
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Keyboard shortcuts</div>
            <div className="mt-3 divide-y divide-[var(--color-border-tertiary)] rounded-xl border border-[var(--color-border-tertiary)]">
              {SHORTCUTS.map(({ keys, desc }) => (
                <div key={keys} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-[var(--color-text-secondary)]">{desc}</span>
                  <kbd className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-tertiary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)]">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">About Noetica</div>
            <div className="mt-3 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs leading-6 text-[var(--color-text-secondary)]">
              Noetica is a sovereign AI workstation — a Tauri 2 + Next.js 14 desktop app for working across multiple models via structured surfaces: Chat, Projects, Evaluate, Tune, Govern, Cowork, Notes, Artifacts, Code, and Operate.
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Surfaces</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-secondary)]">
              {[
                ['Chat', 'Main AI conversation workspace'],
                ['Evaluate', 'Benchmark models across task families'],
                ['Tune', 'DPO comparison and preference labelling'],
                ['Govern', 'Policy, audit trail, evidence bundles'],
                ['Cowork', 'AI-decomposed task collaboration'],
                ['Projects', 'Kanban board and sprint planning'],
              ].map(([name, desc]) => (
                <div key={name} className="rounded-lg border border-[var(--color-border-tertiary)] px-3 py-2">
                  <div className="font-medium text-[var(--color-text-primary)]">{name}</div>
                  <div className="mt-0.5 text-[10px] leading-4">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

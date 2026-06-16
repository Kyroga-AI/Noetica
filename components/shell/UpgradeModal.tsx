'use client'

import { useEffect } from 'react'

const FEATURES: { label: string; available: boolean; tag?: string }[] = [
  { label: 'Unlimited chat sessions',                  available: true },
  { label: 'All AI surfaces (Evaluate, Tune, Govern)', available: true },
  { label: 'MCP server connections',                   available: true },
  { label: 'Fan-out multi-model comparison',           available: true },
  { label: 'Agent Workrooms',                          available: true },
  { label: 'SourceOS runtime integration',             available: true },
  { label: 'SAE steering via Neuronpedia',             available: true },
  { label: 'Team member seats',                        available: false, tag: 'Team' },
  { label: 'Shared governance vault',                  available: false, tag: 'Team' },
  { label: 'Org-wide memory scopes',                   available: false, tag: 'Team' },
  { label: 'Advanced usage analytics',                 available: false, tag: 'Enterprise' },
  { label: 'SSO / SAML',                              available: false, tag: 'Enterprise' },
]

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M2 6.5l3.5 3.5 5.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function CircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[520px] max-h-[85vh] overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Upgrade plan</h2>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="rounded-2xl border border-[rgba(29,78,216,0.30)] bg-[rgba(29,78,216,0.08)] p-5 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Current plan</div>
            <div className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">Development Preview</div>
            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">Full individual access during active development</div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)] mb-2">{"What's included"}</div>
            <div className="space-y-0.5">
              {FEATURES.map(({ label, available, tag }) => (
                <div key={label} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <span className={available ? 'text-[#16a34a]' : 'text-[var(--color-text-tertiary)]'}>
                    {available ? <CheckIcon /> : <CircleIcon />}
                  </span>
                  <span className={`flex-1 text-xs ${available ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>
                    {label}
                  </span>
                  {tag && (
                    <span className="rounded bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-tertiary)]">
                      {tag}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs leading-5 text-[var(--color-text-secondary)]">
            Team and enterprise plans with shared governance, org memory, and advanced analytics are in development. Contact <span className="font-mono text-[var(--color-text-primary)]">hello@socioprophet.ai</span> for early access.
          </div>
        </div>
      </div>
    </div>
  )
}

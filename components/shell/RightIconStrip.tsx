'use client'

import { useUiStore } from '@/lib/store/uiStore'

function IconBrain() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6.5 2.2c-1.6 0-2.9 1.2-2.9 2.7 0 .5.15 1 .4 1.4-.5.4-.8 1-.8 1.7 0 .9.55 1.6 1.3 1.95-.1.25-.15.5-.15.8 0 1.15.95 2.05 2.15 2.05" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"/>
      <path d="M9.5 2.2c1.6 0 2.9 1.2 2.9 2.7 0 .5-.15 1-.4 1.4.5.4.8 1 .8 1.7 0 .9-.55 1.6-1.3 1.95.1.25.15.5.15.8 0 1.15-.95 2.05-2.15 2.05" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"/>
      <path d="M8 2.2v10.6" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  )
}

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.5 13.5 4v4.2c0 3.4-2.5 5.5-5.5 6.3-3-.8-5.5-2.9-5.5-6.3V4L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M5.5 8l1.8 1.8L10.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Permanent 44px right-edge icon strip — always visible on every surface (never suppressed, per the
// design handoff's confirmed behavior), sibling of the Knowledge panel and Governance drawer at the
// outer app-body level.
export function RightIconStrip() {
  const knowledgeOpen = useUiStore((s) => s.knowledgePanelOpen)
  const toggleKnowledge = useUiStore((s) => s.toggleKnowledgePanel)
  const govOpen = useUiStore((s) => s.governanceDrawerOpen)
  const toggleGov = useUiStore((s) => s.toggleGovernanceDrawer)

  return (
    <aside
      className="hidden w-11 shrink-0 flex-col items-center gap-1.5 border-l pt-3.5 lg:flex"
      style={{ background: 'var(--paper-sunk)', borderColor: 'var(--line)' }}
    >
      <button
        onClick={toggleKnowledge}
        title="Knowledge"
        aria-pressed={knowledgeOpen}
        className="flex h-8 w-8 items-center justify-center rounded-[9px] transition"
        style={knowledgeOpen ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' } : { color: 'var(--ink2)' }}
      >
        <IconBrain />
      </button>
      <button
        onClick={toggleGov}
        title="Trust & governance"
        aria-pressed={govOpen}
        className="flex h-8 w-8 items-center justify-center rounded-[9px] transition"
        style={govOpen ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' } : { color: 'var(--ink2)' }}
      >
        <IconShield />
      </button>
    </aside>
  )
}

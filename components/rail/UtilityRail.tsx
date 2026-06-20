'use client'

import { EvidenceRailPanel } from './panels/EvidenceRailPanel'
import { SourceOSRailPanel } from './panels/SourceOSRailPanel'
import { GraphRailPanel }   from './panels/GraphRailPanel'
import { ContextSlot }      from '@/components/shell/RightSidebar'
import type { GovernanceTrace } from '@/lib/types/governance'

// The single right rail. Hosts the real panels — Context plus Noetica's governance /
// sovereignty surfaces (Graph, Evidence, SourceOS). The old demo panels (Calendar /
// Mail / Matrix / Agents / Related) were placeholder shells and are intentionally out.
export type UtilityPanelId =
  | 'context'
  | 'evidence'
  | 'sourceos'
  | 'graph'

const RAIL_ITEMS: { id: UtilityPanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'context',  label: 'Context',  icon: <IconContext /> },
  { id: 'graph',    label: 'Graph',    icon: <IconGraph /> },
  { id: 'evidence', label: 'Evidence', icon: <IconEvidence /> },
  { id: 'sourceos', label: 'SourceOS', icon: <IconSourceOS /> },
]

type ContextData = {
  inScopeFiles: string[]
  toolActivity: { id: string; name: string; target: string }[]
  fileChanges: { id: string; path: string; content: string }[]
}

function renderPanel(id: UtilityPanelId, lastGovernance: GovernanceTrace | undefined, ctx: ContextData) {
  switch (id) {
    case 'context':  return <ContextSlot inScopeFiles={ctx.inScopeFiles} activity={ctx.toolActivity} changes={ctx.fileChanges} />
    case 'evidence': return <EvidenceRailPanel governance={lastGovernance} />
    case 'sourceos': return <SourceOSRailPanel />
    case 'graph':    return <GraphRailPanel />
  }
}

type UtilityRailProps = {
  activePanel: UtilityPanelId | null
  onSelect: (id: UtilityPanelId | null) => void
  lastGovernance?: GovernanceTrace
  inScopeFiles?: string[]
  toolActivity?: { id: string; name: string; target: string }[]
  fileChanges?: { id: string; path: string; content: string }[]
}

export function UtilityRail({ activePanel, onSelect, lastGovernance, inScopeFiles = [], toolActivity = [], fileChanges = [] }: UtilityRailProps) {
  const ctx: ContextData = { inScopeFiles, toolActivity, fileChanges }
  return (
    <>
      {/* Expanded panel */}
      {activePanel && (
        <div className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] lg:flex">
          <div className="border-b border-[var(--color-border-tertiary)] px-3 py-2.5 text-xs font-semibold text-[var(--color-text-primary)]">
            {RAIL_ITEMS.find((r) => r.id === activePanel)?.label}
          </div>
          {renderPanel(activePanel, lastGovernance, ctx)}
        </div>
      )}

      {/* Icon strip */}
      <aside className="hidden w-11 shrink-0 flex-col items-center border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] py-3 lg:flex">
        <nav className="flex flex-1 flex-col items-center gap-1">
          {RAIL_ITEMS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => onSelect(activePanel === id ? null : id)}
              title={label}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                activePanel === id
                  ? 'bg-[#dbeafe] text-[#1d4ed8]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {icon}
            </button>
          ))}
        </nav>
      </aside>
    </>
  )
}

// Icons
function IconContext() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 2l5.5 3L8 8 2.5 5 8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2.5 8L8 11l5.5-3M2.5 11L8 14l5.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
}
function IconCalendar() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
function IconMail() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M2 5l6 5 6-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
function IconMatrix() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/></svg>
}
function IconAgents() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="13" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>
}
function IconRelated() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="3" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="13" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="3" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="13" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M4.5 5L6.5 7M11.5 5L9.5 7M4.5 11L6.5 9M11.5 11L9.5 9" stroke="currentColor" strokeWidth="1.1"/></svg>
}
function IconEvidence() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 2 2 5v4c0 3 2.5 4.5 6 5.5 3.5-1 6-2.5 6-5.5V5L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function IconSourceOS() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 2l5.2 3v6L8 14 2.8 11V5L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
}
function IconGraph() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="3" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="3" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="13" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v2M8 7L3.5 10M8 7l4.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
}

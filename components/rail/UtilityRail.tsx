'use client'

import { useState, useEffect } from 'react'
import { GraphRailPanel }   from './panels/GraphRailPanel'
import { AnswerInspectorPanel } from './panels/AnswerInspectorPanel'
import { LiveRailPanel, type LiveTurn } from './panels/LiveRailPanel'
import { ContextSlot }      from '@/components/shell/RightSidebar'
import type { ChatMessage } from '@/lib/types/message'

// The single right rail. Hosts the real working panels — Answer (per-reply inspector), Graph, and
// Context. Substrate/runtime health lives in the topbar RuntimeStatus chip (SourceOS panel removed as
// duplication); per-turn evidence/governance now lives in the Answer inspector (Evidence panel merged in).
export type UtilityPanelId =
  | 'answer'
  | 'live'
  | 'context'
  | 'graph'

// Icons are thunks (rendered at map time), NOT inline elements: a module-level const that referenced the
// icon components directly hit a forward-reference — under React Fast Refresh the component declarations
// below aren't hoisted into this initializer, throwing "IconX is not defined" in dev. Deferring to a
// thunk means the reference resolves at render, after the module has fully loaded.
const RAIL_ITEMS: { id: UtilityPanelId; label: string; icon: () => React.ReactNode }[] = [
  { id: 'answer',   label: 'Answer',   icon: () => <IconAnswer /> },
  { id: 'live',     label: 'Live',     icon: () => <IconLive /> },
  { id: 'graph',    label: 'Graph',    icon: () => <IconGraph /> },
  { id: 'context',  label: 'Activity', icon: () => <IconContext /> },
]

type ContextData = {
  inScopeFiles: string[]
  toolActivity: { id: string; name: string; target: string }[]
  fileChanges: { id: string; path: string; content: string }[]
}

type LiveData = { turns: LiveTurn[]; isLive: boolean; onCommit?: (id: string) => void; onClear?: () => void }

function renderPanel(id: UtilityPanelId, ctx: ContextData, inspectMessage: ChatMessage | null, live: LiveData) {
  switch (id) {
    case 'answer':   return <AnswerInspectorPanel message={inspectMessage} />
    case 'live':     return <LiveRailPanel turns={live.turns} isLive={live.isLive} onCommit={live.onCommit} onClear={live.onClear} />
    case 'context':  return <ContextSlot inScopeFiles={ctx.inScopeFiles} activity={ctx.toolActivity} changes={ctx.fileChanges} />
    case 'graph':    return <GraphRailPanel />
  }
}

type UtilityRailProps = {
  activePanel: UtilityPanelId | null
  onSelect: (id: UtilityPanelId | null) => void
  inspectMessage?: ChatMessage | null
  liveTurns?: LiveTurn[]
  isLive?: boolean
  onCommitLive?: (id: string) => void
  onClearLive?: () => void
  inScopeFiles?: string[]
  toolActivity?: { id: string; name: string; target: string }[]
  fileChanges?: { id: string; path: string; content: string }[]
  // Tune (model + generation controls) lives in the resizable inspector; expose a visible toggle here so
  // it isn't buried in the View menu.
  onToggleInspector?: () => void
  inspectorOpen?: boolean
}

const RAIL_MIN = 240
const RAIL_MAX = 760

export function UtilityRail({ activePanel, onSelect, inspectMessage = null, liveTurns = [], isLive = false, onCommitLive, onClearLive, inScopeFiles = [], toolActivity = [], fileChanges = [], onToggleInspector, inspectorOpen = false }: UtilityRailProps) {
  const ctx: ContextData = { inScopeFiles, toolActivity, fileChanges }
  const live: LiveData = { turns: liveTurns, isLive, onCommit: onCommitLive, onClear: onClearLive }
  const [width, setWidth] = useState(288)
  useEffect(() => {
    const s = Number(localStorage.getItem('noetica-rail-w'))
    if (s >= RAIL_MIN && s <= RAIL_MAX) setWidth(s)
  }, [])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX, startW = width
    let latest = startW
    const move = (ev: MouseEvent) => { latest = Math.min(RAIL_MAX, Math.max(RAIL_MIN, startW + (startX - ev.clientX))); setWidth(latest) }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''; document.body.style.cursor = ''
      localStorage.setItem('noetica-rail-w', String(latest))
    }
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }

  return (
    <>
      {/* Expanded panel — resizable via the left-edge handle */}
      {activePanel && (
        <div className="relative hidden shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] lg:flex" style={{ width }}>
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="group absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-[#3b82f6]/40"
          >
            <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-[var(--color-border-secondary)] group-hover:bg-[#3b82f6]" />
          </div>
          <div className="border-b border-[var(--color-border-tertiary)] px-3 py-2.5 text-xs font-semibold text-[var(--color-text-primary)]">
            {RAIL_ITEMS.find((r) => r.id === activePanel)?.label}
          </div>
          {renderPanel(activePanel, ctx, inspectMessage, live)}
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
                  ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {icon()}
            </button>
          ))}
        </nav>
        {/* Tune — model + generation controls (the inspector). A visible toggle so it isn't menu-only. */}
        {onToggleInspector && (
          <button
            onClick={onToggleInspector}
            title="Tune — model & generation"
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              inspectorOpen ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <IconTune />
          </button>
        )}
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
function IconAnswer() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H6l-3 3V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M5.5 6h5M5.5 8.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
}
function IconLive() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2.5" y="6.5" width="1.5" height="3" rx="0.75" fill="currentColor"/><rect x="5.5" y="4" width="1.5" height="8" rx="0.75" fill="currentColor"/><rect x="8.5" y="5.5" width="1.5" height="5" rx="0.75" fill="currentColor"/><rect x="11.5" y="6.5" width="1.5" height="3" rx="0.75" fill="currentColor"/></svg>
}
function IconTune() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 4h6M11 4h2M3 8h2M7 8h6M3 12h8M13 12h0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="10" cy="4" r="1.4" stroke="currentColor" strokeWidth="1.3"/><circle cx="6" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="12" r="1.4" stroke="currentColor" strokeWidth="1.3"/></svg>
}
function IconGraph() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="3" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="3" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="13" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v2M8 7L3.5 10M8 7l4.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActiveSurface } from '@/lib/types/surface'

type PaletteAction = {
  id: string
  label: string
  shortcut?: string
  group: string
  run: () => void
}

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  onNewChat: () => void
  onOpenSettings: (category?: string) => void
  onSwitchSurface: (surface: ActiveSurface) => void
  onToggleSidebar: () => void
  onToggleInspector: () => void
}

export function CommandPalette({
  open,
  onClose,
  onNewChat,
  onOpenSettings,
  onSwitchSurface,
  onToggleSidebar,
  onToggleInspector,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const actions = useMemo<PaletteAction[]>(() => [
    { id: 'new_chat',              label: 'New chat',                   shortcut: '⌘N', group: 'Chat',     run: () => { onNewChat(); onClose() } },
    { id: 'surface_chat',         label: 'Switch to Workspace',        shortcut: '⌘1', group: 'Surfaces', run: () => { onSwitchSurface('chat');       onClose() } },
    { id: 'surface_notes',        label: 'Switch to Notes',            shortcut: '⌘2', group: 'Surfaces', run: () => { onSwitchSurface('notes');       onClose() } },
    { id: 'surface_workrooms',    label: 'Switch to Workrooms',        shortcut: '⌘3', group: 'Surfaces', run: () => { onSwitchSurface('workrooms');   onClose() } },
    { id: 'surface_cowork',       label: 'Switch to Cowork',           shortcut: '⌘4', group: 'Surfaces', run: () => { onSwitchSurface('cowork');      onClose() } },
    { id: 'surface_projects',     label: 'Switch to Projects',         shortcut: '⌘5', group: 'Surfaces', run: () => { onSwitchSurface('projects');    onClose() } },
    { id: 'surface_artifacts',    label: 'Switch to Artifacts',        shortcut: '⌘6', group: 'Surfaces', run: () => { onSwitchSurface('artifacts');   onClose() } },
    { id: 'surface_code',         label: 'Switch to Source / Repos',   shortcut: '⌘7', group: 'Surfaces', run: () => { onSwitchSurface('code');        onClose() } },
    { id: 'surface_eval',         label: 'Switch to Evaluate',         shortcut: '⌘8', group: 'Surfaces', run: () => { onSwitchSurface('evaluate');    onClose() } },
    { id: 'surface_operate',      label: 'Switch to Operate',          shortcut: '⌘9', group: 'Surfaces', run: () => { onSwitchSurface('operate');     onClose() } },
    { id: 'surface_tune',         label: 'Switch to Tune & Train',                     group: 'Surfaces', run: () => { onSwitchSurface('tune');        onClose() } },
    { id: 'surface_govern',       label: 'Switch to Govern',                           group: 'Surfaces', run: () => { onSwitchSurface('govern');      onClose() } },
    { id: 'surface_holographme',  label: 'Switch to HolographMe',                      group: 'Surfaces', run: () => { onSwitchSurface('holographme'); onClose() } },
    { id: 'surface_marketplace',  label: 'Switch to Marketplace',                      group: 'Surfaces', run: () => { onSwitchSurface('marketplace'); onClose() } },
    { id: 'toggle_sidebar',  label: 'Toggle sidebar',        shortcut: '⌘\\',  group: 'View',     run: () => { onToggleSidebar();  onClose() } },
    { id: 'toggle_inspector',label: 'Toggle inspector',      shortcut: '⌘I',   group: 'View',     run: () => { onToggleInspector(); onClose() } },
    { id: 'settings',        label: 'Open settings',         shortcut: '⌘,',   group: 'App',      run: () => { onOpenSettings();           onClose() } },
    { id: 'settings_models', label: 'Settings — Models',                        group: 'App',      run: () => { onOpenSettings('models');   onClose() } },
    { id: 'settings_runtime',label: 'Settings — Runtime',                       group: 'App',      run: () => { onOpenSettings('runtime');  onClose() } },
    { id: 'settings_mcp',    label: 'Settings — Connectors (MCP)',              group: 'App',      run: () => { onOpenSettings('connectors'); onClose() } },
  ], [onClose, onNewChat, onOpenSettings, onSwitchSurface, onToggleSidebar, onToggleInspector])

  const filtered = useMemo(() => {
    if (!query.trim()) return actions
    const q = query.toLowerCase()
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q))
  }, [actions, query])

  // Reset selection when filter changes
  useEffect(() => { setSelectedIndex(0) }, [query])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter')     { e.preventDefault(); filtered[selectedIndex]?.run() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, selectedIndex, onClose])

  if (!open) return null

  // Group filtered results
  const groups = filtered.reduce<Record<string, PaletteAction[]>>((acc, action) => {
    if (!acc[action.group]) acc[action.group] = []
    acc[action.group].push(action)
    return acc
  }, {})

  let globalIndex = 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-4 py-3">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands…"
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
          <kbd className="rounded border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--color-text-tertiary)]">No commands match &ldquo;{query}&rdquo;</div>
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                  {group}
                </div>
                {items.map((action) => {
                  const idx = globalIndex++
                  return (
                    <button
                      key={action.id}
                      onClick={action.run}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition ${
                        selectedIndex === idx ? 'bg-[#eff6ff] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'
                      }`}
                    >
                      <span>{action.label}</span>
                      {action.shortcut && (
                        <kbd className="rounded border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                          {action.shortcut}
                        </kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { AppearancePanel } from './panels/AppearancePanel'
import { ModelsPanel } from './panels/ModelsPanel'
import { RuntimePanel } from './panels/RuntimePanel'
import { ConnectorsPanel } from './panels/ConnectorsPanel'
import { ConnectionsPanel } from './panels/ConnectionsPanel'
import { MemoryPanel } from './panels/MemoryPanel'
import { FanoutPanel } from './panels/FanoutPanel'
import { DeveloperPanel } from './panels/DeveloperPanel'
import { OrgPanel } from './panels/OrgPanel'
import { PolicyPanel } from './panels/PolicyPanel'

type Category = {
  id: string
  label: string
  icon: React.ReactNode
  panel: React.ReactNode
  badge?: string
}

function IconAppearance() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2v6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconModels() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2 2 5v6l6 3 6-3V5L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 2v12M2 5l6 3 6-3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}
function IconRuntime() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 14h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function IconConnectors() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="4" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 8h2l3-3.5M7.5 8l3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function IconMemory() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 5h12M2 8h12M2 11h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
function IconFanout() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="2.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13.5" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13.5" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 8h3.5M7.5 8l4.5-4M7.5 8h4.5M7.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function IconDeveloper() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5 5 2 8l3 3M11 5l3 3-3 3M9 3l-2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconOrganization() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 13V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8M1 13h14M6 12V9h4v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconConnections() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 8h1.5M10 4.5l-2 2.5M10 11.5l-2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function IconPolicy() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.5L2 4v4c0 3.3 2.5 5.8 6 6.5 3.5-.7 6-3.2 6-6.5V4L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M5.5 8l1.8 1.8L10.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

const categories: Category[] = [
  { id: 'appearance', label: 'Appearance', icon: <IconAppearance />, panel: <AppearancePanel /> },
  { id: 'models', label: 'Models', icon: <IconModels />, panel: <ModelsPanel /> },
  { id: 'runtime', label: 'Runtime', icon: <IconRuntime />, panel: <RuntimePanel /> },
  { id: 'connections', label: 'Connections', icon: <IconConnections />, panel: <ConnectionsPanel /> },
  { id: 'connectors', label: 'Connectors', icon: <IconConnectors />, panel: <ConnectorsPanel />, badge: 'MCP' },
  { id: 'memory', label: 'Memory', icon: <IconMemory />, panel: <MemoryPanel /> },
  { id: 'fanout', label: 'Fan-out', icon: <IconFanout />, panel: <FanoutPanel /> },
  { id: 'developer', label: 'Developer', icon: <IconDeveloper />, panel: <DeveloperPanel /> },
  { id: 'organization', label: 'Organization', icon: <IconOrganization />, panel: <OrgPanel /> },
  { id: 'policy', label: 'Policy', icon: <IconPolicy />, panel: <PolicyPanel /> },
]

type SettingsModalProps = {
  open: boolean
  onClose: () => void
  initialCategory?: string
}

export function SettingsModal({ open, onClose, initialCategory = 'appearance' }: SettingsModalProps) {
  const [activeId, setActiveId] = useState(initialCategory)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Sync if parent sets initialCategory while already open
  useEffect(() => {
    if (open) setActiveId(initialCategory)
  }, [open, initialCategory])

  // Escape to close
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const active = categories.find((c) => c.id === activeId) ?? categories[0]

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[600px] w-[820px] max-h-[90vh] max-w-[95vw] overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl"
      >
        {/* Left nav */}
        <nav className="flex w-48 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] py-4">
          <div className="px-4 pb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">
            Settings
          </div>
          <div className="flex-1 space-y-0.5 px-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveId(cat.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition ${
                  activeId === cat.id
                    ? 'bg-[rgba(29,78,216,0.15)] font-semibold text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <span className={activeId === cat.id ? 'text-[#1d4ed8]' : 'text-[var(--color-text-tertiary)]'}>
                  {cat.icon}
                </span>
                <span className="flex-1">{cat.label}</span>
                {cat.badge && (
                  <span className="rounded-full bg-[rgba(29,78,216,0.10)] px-1.5 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">
                    {cat.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-6 py-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{active.label}</h2>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)]"
              aria-label="Close settings"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {active.panel}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import type { ActiveSurface } from '@/lib/types/surface'
import type { WorkspaceSession } from '@/lib/session/types'
import { HelpModal } from '@/components/shell/HelpModal'
import { UpgradeModal } from '@/components/shell/UpgradeModal'
import { ChangelogModal } from '@/components/shell/ChangelogModal'

type SidebarProps = {
  activeSurface: ActiveSurface
  onSurfaceChange: (surface: ActiveSurface) => void
  onOpenSettings: (category?: string) => void
  sessions?: WorkspaceSession[]
  activeSessionId?: string | null
  onSwitchSession?: (id: string) => void
  onRemoveSession?: (id: string) => void
  onNewChat?: () => void
}

type SurfaceItem = {
  id: ActiveSurface
  label: string
  icon: React.ReactNode
  items: string[]
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}
function IconNotes() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 5h6M5 8h6M5 11h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
function IconWorkrooms() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M2 4l6-2.5L14 4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <circle cx="8" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 12c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function IconCowork() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="5.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1 13c0-2 2-3 4.5-3s4.5 1 4.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10.5 10c2.5 0 4.5 1 4.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconCode() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5 5 2 8l3 3M11 5l3 3-3 3M9 3l-2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconEvaluate() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="9" width="3" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6.5" y="6" width="3" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11" y="3" width="3" height="11" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
function IconProjects() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 11.5h6M12 8.5v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconArtifacts() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 2v3h3M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function IconOperate() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 11 5 6l3 4 2-3 3 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function IconGovern() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2 2 5v3c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V5L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.5 8l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconHolograph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 13c0-2.2 2.2-4 5-4s5 1.8 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M1 8l2-2M15 8l-2-2M1 10l2 2M15 10l-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function IconMarketplace() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 5h12l-1.5 7H3.5L2 5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M5 5V3.5a3 3 0 0 1 6 0V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="6" cy="9" r="1" fill="currentColor"/>
      <circle cx="10" cy="9" r="1" fill="currentColor"/>
    </svg>
  )
}
function IconTune() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="5" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="11" cy="11" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 1v2.2M5 6.8V15M11 1v7.2M11 12.8V15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className={className}>
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const surfaceItems: SurfaceItem[] = [
  {
    id: 'chat',
    label: 'Workspace',
    icon: <IconChat />,
    items: ['New conversation', 'Recent threads', 'Pinned']
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: <IconProjects />,
    items: ['Active projects', 'Workrooms', 'Backlog', 'Sprints']
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: <IconArtifacts />,
    items: ['Documents', 'Code files', 'Evidence bundles']
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    icon: <IconEvaluate />,
    items: ['Task benchmarks', 'Model families', 'Outcome traces']
  },
  {
    id: 'tune',
    label: 'Tune & Train',
    icon: <IconTune />,
    items: ['Comparative runs', 'Preference pairs', 'DPO export']
  },
  {
    id: 'operate',
    label: 'Operate',
    icon: <IconOperate />,
    items: ['Graph health', 'Time service', 'Sync queues', 'Event ledger']
  },
  {
    id: 'govern',
    label: 'Govern',
    icon: <IconGovern />,
    items: ['Policy trace', 'Memory scope', 'Evidence export']
  },
  {
    id: 'holographme',
    label: 'HolographMe',
    icon: <IconHolograph />,
    items: []
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: <IconMarketplace />,
    items: []
  },
]

type SessionTreeProps = {
  sessions: WorkspaceSession[]
  activeSessionId?: string | null
  search: string
  onSwitchSession?: (id: string) => void
  onRemoveSession?: (id: string) => void
}

function SessionRow({ s, depth, activeSessionId, onSwitchSession, onRemoveSession, children }: {
  s: WorkspaceSession
  depth: number
  activeSessionId?: string | null
  onSwitchSession?: (id: string) => void
  onRemoveSession?: (id: string) => void
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const hasBranches = !!children
  return (
    <div>
      <div className="group flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        {hasBranches && (
          <button onClick={() => setOpen((v) => !v)}
            className="shrink-0 flex h-4 w-4 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            title={open ? 'Collapse branches' : 'Expand branches'}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden
              style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.1s' }}>
              <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {!hasBranches && depth > 0 && (
          <span className="shrink-0 flex h-4 w-4 items-center justify-center text-[var(--color-border-secondary)]">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M1 1v4a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </span>
        )}
        {depth === 0 && !hasBranches && <span className="w-4 shrink-0" />}
        <button
          onClick={() => onSwitchSession?.(s.id)}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-xs transition ${
            s.id === activeSessionId
              ? 'bg-[#dbeafe] font-semibold text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {depth > 0 && (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden className="shrink-0 text-[#93c5fd]">
              <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="4.5" cy="4.5" r="1.5" fill="currentColor"/>
            </svg>
          )}
          <span className="truncate">{s.title}</span>
        </button>
        <button
          onClick={() => onRemoveSession?.(s.id)}
          className="hidden shrink-0 h-5 w-5 items-center justify-center rounded text-[var(--color-text-tertiary)] transition hover:text-[#ef4444] group-hover:flex"
          title="Remove"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      {hasBranches && open && children}
    </div>
  )
}

function SessionTree({ sessions, activeSessionId, search, onSwitchSession, onRemoveSession }: SessionTreeProps) {
  const limit = search ? 20 : 8
  const displaySessions = sessions.slice(0, limit)

  const childMap = new Map<string, WorkspaceSession[]>()
  const roots: WorkspaceSession[] = []
  for (const s of displaySessions) {
    if (s.parentId && sessions.find((p) => p.id === s.parentId)) {
      const arr = childMap.get(s.parentId) ?? []
      arr.push(s)
      childMap.set(s.parentId, arr)
    } else {
      roots.push(s)
    }
  }

  function renderNode(s: WorkspaceSession, depth: number): React.ReactNode {
    const kids = childMap.get(s.id)
    return (
      <SessionRow key={s.id} s={s} depth={depth} activeSessionId={activeSessionId}
        onSwitchSession={onSwitchSession} onRemoveSession={onRemoveSession}
      >{kids ? <>{kids.map((k) => renderNode(k, depth + 1))}</> : undefined}</SessionRow>
    )
  }

  return (
    <div className="mb-2">
      <div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">{search ? 'Results' : 'Recent'}</div>
      {roots.map((s) => renderNode(s, 0))}
      <div className="my-1.5 border-t border-[var(--color-border-tertiary)]" />
    </div>
  )
}

export function Sidebar({
  activeSurface, onSurfaceChange, onOpenSettings,
  sessions = [], activeSessionId = null,
  onSwitchSession, onRemoveSession, onNewChat,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [subView, setSubView] = useState<'language' | 'learn-more' | null>(null)
  const closeMenu = () => { setUserMenuOpen(false); setSubView(null) }

  const filteredSessions = search.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
    : sessions

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] py-3 lg:flex">
        <button
          onClick={() => setCollapsed(false)}
          className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"
          aria-label="Expand sidebar"
        >
          <IconChevronRight />
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {surfaceItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onSurfaceChange(item.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                activeSurface === item.id
                  ? 'bg-[#dbeafe] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </nav>
        <button
          onClick={() => onOpenSettings()}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"
          title="Settings"
        >
          <IconSettings />
        </button>
      </aside>
    )
  }

  return (
    <>
    <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] px-2 py-2 lg:flex h-full overflow-y-auto">
      {/* Header row */}
      <div className="flex items-center gap-1 pb-1">
        <button
          className="flex flex-1 items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-background-secondary)]"
          onClick={onNewChat ?? (() => onSurfaceChange('chat'))}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          New workspace
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"
          aria-label="Collapse sidebar"
        >
          <IconChevronLeft />
        </button>
      </div>

      {/* Search */}
      {activeSurface === 'chat' && sessions.length > 0 && (
        <div className="px-1 pb-1">
          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 py-1">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]">
              <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7.5 7.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search chats…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
        {/* Recent sessions — shown when Chat surface is active */}
        {activeSurface === 'chat' && filteredSessions.length > 0 && (
          <SessionTree
            sessions={filteredSessions}
            activeSessionId={activeSessionId}
            search={search}
            onSwitchSession={onSwitchSession}
            onRemoveSession={onRemoveSession}
          />
        )}
        {(['chat','projects','artifacts','evaluate','tune','operate','govern'] as ActiveSurface[]).map((id) => {
          const item = surfaceItems.find(s => s.id === id)!
          const isActive = activeSurface === id
          return (
            <button
              key={id}
              onClick={() => onSurfaceChange(id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition ${
                isActive
                  ? 'bg-[#dbeafe] font-medium text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className={`shrink-0 ${isActive ? 'text-[#1d4ed8]' : ''}`}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
        <div className="px-2 pt-2 pb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Platform</div>
        {(['holographme','marketplace'] as ActiveSurface[]).map((id) => {
          const item = surfaceItems.find(s => s.id === id)!
          const isActive = activeSurface === id
          return (
            <button
              key={id}
              onClick={() => onSurfaceChange(id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition ${
                isActive
                  ? 'bg-[#dbeafe] font-medium text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className={`shrink-0 ${isActive ? 'text-[#1d4ed8]' : ''}`}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
              <span className="ml-auto rounded bg-[var(--color-background-secondary)] px-1 py-px text-[8px] font-medium text-[var(--color-text-tertiary)]">soon</span>
            </button>
          )
        })}
      </nav>

      {/* Account footer */}
      <div className="relative border-t border-[var(--color-border-tertiary)] pt-1 mt-1">
        {userMenuOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-lg z-50 py-1 overflow-hidden">
            {subView === 'language' ? (
              <>
                <button onClick={() => setSubView(null)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] transition">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M7 2L3 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Back
                </button>
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Language</div>
                {[
                  { code: 'en', native: 'English', current: true },
                  { code: 'es', native: 'Español', current: false },
                  { code: 'fr', native: 'Français', current: false },
                  { code: 'de', native: 'Deutsch', current: false },
                  { code: 'ja', native: '日本語', current: false },
                  { code: 'zh', native: '简体中文', current: false },
                ].map((lang) => (
                  <button key={lang.code} onClick={() => closeMenu()}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-[12px] hover:bg-[var(--color-background-secondary)] transition text-left ${lang.current ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                    <span className="flex-1">{lang.native}</span>
                    {lang.current && <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="text-[#1d4ed8]"><path d="M2 5.5l3 3 4.5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                ))}
              </>
            ) : subView === 'learn-more' ? (
              <>
                <button onClick={() => setSubView(null)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] transition">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M7 2L3 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Back
                </button>
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Resources</div>
                {[
                  { label: 'Noetica documentation', desc: 'User guide and surface reference' },
                  { label: 'Anthropic API docs', desc: 'Claude API integration reference' },
                  { label: 'Community forum', desc: 'Ask questions and share feedback' },
                  { label: 'Keyboard shortcuts', desc: 'View all shortcuts — press ⌘,' },
                ].map((link) => (
                  <button key={link.label} onClick={() => { if (link.label === 'Keyboard shortcuts') { setHelpOpen(true) } closeMenu() }}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-[var(--color-background-secondary)] transition">
                    <span className="text-[12px] text-[var(--color-text-primary)]">{link.label}</span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">{link.desc}</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)] border-b border-[var(--color-border-tertiary)] mb-1">
                  michael@socioprophet.ai
                </div>
                {[
                  { label: 'Settings', hint: '⌘,', icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, action: () => { onOpenSettings(); closeMenu() } },
                  { label: 'Organization settings', badge: '1', icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 13V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8M1 13h14M6 12V9h4v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>, action: () => { onOpenSettings('organization'); closeMenu() } },
                  { label: 'Analytics', icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 13h12M4 13V9m3 4V6m3 7V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, action: () => { onSurfaceChange('evaluate'); closeMenu() } },
                  { label: 'Language', arrow: true, icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5c-2 2-3 4-3 6.5s1 4.5 3 6.5M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5M1.5 8h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, action: () => setSubView('language') },
                  { label: 'Get help', icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2v1.5M8 11.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, action: () => { setHelpOpen(true); closeMenu() } },
                ].map((item) => (
                  <button key={item.label} onClick={item.action}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-background-secondary)] transition text-left">
                    <span className="text-[var(--color-text-secondary)]">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.hint && <span className="text-[10px] text-[var(--color-text-tertiary)]">{item.hint}</span>}
                    {item.badge && <span className="flex h-4 w-4 items-center justify-center rounded bg-[#ef4444] text-[9px] font-bold text-white">{item.badge}</span>}
                    {item.arrow && <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden><path d="M3 2l2.5 2.5L3 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                ))}
                <div className="border-t border-[var(--color-border-tertiary)] my-1"/>
                {[
                  { label: 'Upgrade plan', blue: true, icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 11V5M5.5 7.5L8 5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>, action: () => { setUpgradeOpen(true); closeMenu() } },
                  { label: 'Get apps and extensions', icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 11V5l5 3 5-3v6l-5 3-5-3z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>, action: () => { onOpenSettings('connectors'); closeMenu() } },
                  { label: 'View changelog', icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, action: () => { setChangelogOpen(true); closeMenu() } },
                  { label: 'Learn more', arrow: true, icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7.5V11M8 5.5v-.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, action: () => setSubView('learn-more') },
                ].map((item) => (
                  <button key={item.label} onClick={item.action}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-[12px] hover:bg-[var(--color-background-secondary)] transition text-left ${item.blue ? 'text-[#3b82f6]' : 'text-[var(--color-text-primary)]'}`}>
                    <span className={item.blue ? 'text-[#3b82f6]' : 'text-[var(--color-text-secondary)]'}>{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.arrow && <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden><path d="M3 2l2.5 2.5L3 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                ))}
                <div className="border-t border-[var(--color-border-tertiary)] my-1"/>
                <button
                  onClick={() => {
                    Object.keys(localStorage).filter(k => k.startsWith('noetica:')).forEach(k => localStorage.removeItem(k))
                    window.location.reload()
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-background-secondary)] transition text-left">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span>Log out</span>
                </button>
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--color-background-secondary)]"
        >
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
          >
            M
          </div>
          <span className="flex-1 truncate text-[11px] font-medium text-[var(--color-text-primary)]">Michael</span>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]">
            <path d="M2 4l3.5 3.5L9 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </aside>
    {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    {upgradeOpen && <UpgradeModal onClose={() => setUpgradeOpen(false)} />}
    {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
    </>
  )
}

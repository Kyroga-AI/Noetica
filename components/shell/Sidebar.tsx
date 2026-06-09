'use client'

import { useState } from 'react'
import type { ActiveSurface } from '@/lib/types/surface'

type SidebarProps = {
  activeSurface: ActiveSurface
  onSurfaceChange: (surface: ActiveSurface) => void
  onOpenSettings: () => void
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
    label: 'Chat',
    icon: <IconChat />,
    items: ['New conversation', 'Recent threads', 'Pinned']
  },
  {
    id: 'cowork',
    label: 'Cowork',
    icon: <IconCowork />,
    items: ['Shared task room', 'Decision review', 'Artifact planning']
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
    id: 'code',
    label: 'Source',
    icon: <IconCode />,
    items: ['Gitea Sovereign', 'Local Git', 'Repository graph']
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    icon: <IconEvaluate />,
    items: ['Task benchmarks', 'Model families', 'Outcome traces']
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
  }
]

export function Sidebar({ activeSurface, onSurfaceChange, onOpenSettings }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-[#d7dee8] bg-[#eaf1f8] py-3 lg:flex">
        <button
          onClick={() => setCollapsed(false)}
          className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
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
                  ? 'bg-[#dbeafe] text-[#0f172a]'
                  : 'text-[#64748b] hover:bg-white hover:text-[#0f172a]'
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </nav>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
          title="Settings"
        >
          <IconSettings />
        </button>
      </aside>
    )
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-[#d7dee8] bg-[#eaf1f8] px-2 py-3 lg:flex">
      {/* Header row */}
      <div className="flex items-center justify-between px-2 pb-3">
        <button
          className="flex w-full items-center justify-center rounded-xl border border-[#bfdbfe] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc]"
          onClick={() => onSurfaceChange('chat')}
        >
          + New workspace
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
          aria-label="Collapse sidebar"
        >
          <IconChevronLeft />
        </button>
      </div>

      {/* Navigation */}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
        {surfaceItems.map((item) => {
          const isActive = activeSurface === item.id
          return (
            <div key={item.id}>
              <button
                onClick={() => onSurfaceChange(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition ${
                  isActive
                    ? 'bg-[#dbeafe] text-[#0f172a]'
                    : 'text-[#334155] hover:bg-white hover:text-[#0f172a]'
                }`}
              >
                <span className={isActive ? 'text-[#1d4ed8]' : 'text-[#64748b]'}>{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                <IconChevronRight
                  className={`shrink-0 transition-transform ${isActive ? 'rotate-90' : ''}`}
                />
              </button>
              {isActive && (
                <div className="mb-1 mt-0.5 space-y-0.5 pl-9">
                  {item.items.map((sub) => (
                    <button
                      key={sub}
                      className="w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Account footer */}
      <div className="mt-3 border-t border-[#d7dee8] pt-3 px-1 space-y-0.5">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
        >
          <IconSettings />
          <span>Settings</span>
        </button>
        <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-xs font-semibold text-white">
            N
          </div>
          <span className="flex-1 truncate text-xs font-semibold text-[#0f172a]">Noetica</span>
        </div>
      </div>
    </aside>
  )
}

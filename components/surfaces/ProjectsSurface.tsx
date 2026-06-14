'use client'

import { useEffect, useRef, useState } from 'react'
import { useWork } from '@/lib/tasks/useWork'
import type { WorkItem, WorkItemStatus, WorkItemPriority, WorkItemType, Sprint } from '@/lib/types/work'

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_COLUMNS: { status: WorkItemStatus; label: string; color: string }[] = [
  { status: 'todo',        label: 'To Do',       color: 'border-[var(--color-border-secondary)]' },
  { status: 'in_progress', label: 'In Progress',  color: 'border-[#bfdbfe]' },
  { status: 'in_review',   label: 'In Review',    color: 'border-[#c7d2fe]' },
  { status: 'done',        label: 'Done',         color: 'border-[#bbf7d0]' },
]

const PRIORITY_COLORS: Record<WorkItemPriority, string> = {
  critical: 'text-[#dc2626]', high: 'text-[#d97706]', medium: 'text-[#2563eb]', low: 'text-[var(--color-text-secondary)]', none: 'text-[var(--color-text-tertiary)]',
}
const PRIORITY_DOT: Record<WorkItemPriority, string> = {
  critical: 'bg-[#dc2626]', high: 'bg-[#f59e0b]', medium: 'bg-[#3b82f6]', low: 'bg-[#94a3b8]', none: 'bg-[#cbd5e1]',
}
const PRIORITY_OPTIONS: WorkItemPriority[] = ['critical', 'high', 'medium', 'low', 'none']
const TYPE_ICONS: Record<WorkItemType, string> = {
  task: '☑', epic: '⚡', story: '📖', bug: '🐞', spike: '🔬', milestone: '🏁',
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({ item, active, onClick }: { item: WorkItem; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex w-full flex-col gap-1.5 rounded-xl border bg-[var(--color-background-primary)] px-3.5 py-2.5 text-left shadow-sm transition hover:shadow-md ${active ? 'border-[#93c5fd] ring-1 ring-[#bfdbfe]' : 'border-[var(--color-border-secondary)]'}`}>
      <div className="flex items-start gap-2">
        <span className="mt-px shrink-0 text-sm">{TYPE_ICONS[item.type]}</span>
        <p className="flex-1 text-xs font-medium leading-5 text-[var(--color-text-primary)] line-clamp-2">{item.title}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1 text-[10px] font-semibold ${PRIORITY_COLORS[item.priority]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[item.priority]}`} />
          {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
        </span>
        {item.tags.slice(0, 2).map((t) => (
          <span key={t} className="rounded-full bg-[var(--color-background-tertiary)] px-1.5 text-[10px] text-[var(--color-text-secondary)]">{t}</span>
        ))}
        <span className="ml-auto shrink-0 text-[10px] text-[#cbd5e1]">{timeAgo(item.updatedAt)}</span>
      </div>
    </button>
  )
}

// ─── Board column ─────────────────────────────────────────────────────────────

function BoardColumn({ status, label, color, items, activeId, onSelect, onAddItem }: {
  status: WorkItemStatus; label: string; color: string
  items: WorkItem[]; activeId: string | null
  onSelect: (item: WorkItem) => void
  onAddItem: (status: WorkItemStatus) => void
}) {
  return (
    <div className={`flex min-h-0 flex-col rounded-2xl border ${color} bg-[var(--color-background-secondary)]`}>
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{label}</p>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">{items.length} {items.length === 1 ? 'item' : 'items'}</p>
        </div>
        <button onClick={() => onAddItem(status)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-primary)] hover:text-[#1d4ed8]">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.map((item) => (
          <TaskCard key={item.id} item={item} active={activeId === item.id} onClick={() => onSelect(item)} />
        ))}
        {items.length === 0 && (
          <button onClick={() => onAddItem(status)}
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--color-border-secondary)] py-3 text-xs text-[var(--color-text-tertiary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]">
            + Add item
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Task detail panel ────────────────────────────────────────────────────────

function TaskDetail({ item, onUpdate, onDelete, onMove, onClose }: {
  item: WorkItem
  onUpdate: (id: string, patch: Partial<WorkItem>) => void
  onDelete: (id: string) => void
  onMove: (id: string, status: WorkItemStatus) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [desc, setDesc] = useState(item.description ?? '')
  const [tagInput, setTagInput] = useState('')

  // Sync when item changes
  useEffect(() => { setTitle(item.title); setDesc(item.description ?? '') }, [item.id, item.title, item.description])

  function save() {
    onUpdate(item.id, { title: title.trim() || item.title, description: desc })
  }

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (tag && !item.tags.includes(tag)) onUpdate(item.id, { tags: [...item.tags, tag] })
    setTagInput('')
  }
  function removeTag(tag: string) {
    onUpdate(item.id, { tags: item.tags.filter((t) => t !== tag) })
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{TYPE_ICONS[item.type]}</span>
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">Task detail</p>
        </div>
        <button onClick={onClose} className="text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Title</label>
          <input className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] outline-none focus:border-[#93c5fd]"
            value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') { save(); (e.target as HTMLInputElement).blur() } }} />
        </div>

        {/* Status + Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Status</label>
            <select
              className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#93c5fd]"
              value={item.status}
              onChange={(e) => onMove(item.id, e.target.value as WorkItemStatus)}>
              {(['backlog','todo','in_progress','in_review','done','cancelled'] as WorkItemStatus[]).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Priority</label>
            <select
              className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#93c5fd]"
              value={item.priority}
              onChange={(e) => onUpdate(item.id, { priority: e.target.value as WorkItemPriority })}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Type */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Type</label>
          <select
            className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#93c5fd]"
            value={item.type}
            onChange={(e) => onUpdate(item.id, { type: e.target.value as WorkItemType })}>
            {(['task','epic','story','bug','spike','milestone'] as WorkItemType[]).map((t) => (
              <option key={t} value={t}>{TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Description</label>
          <textarea
            className="w-full resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
            placeholder="Add details, acceptance criteria, links…"
            rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={save} />
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Tags</label>
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[10px] font-medium text-[#3730a3]">
                {t}
                <button onClick={() => removeTag(t)} className="text-[#6366f1] hover:text-[#3730a3]">×</button>
              </span>
            ))}
          </div>
          <input
            className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
            placeholder="Add tag (Enter or comma)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
            }} />
        </div>

        {/* Timestamps */}
        <div className="space-y-1 text-[11px] text-[var(--color-text-tertiary)]">
          <p>Created {timeAgo(item.createdAt)}</p>
          <p>Updated {timeAgo(item.updatedAt)}</p>
        </div>
      </div>

      {/* Delete */}
      <div className="border-t border-[var(--color-border-secondary)] p-3">
        <button onClick={() => { onDelete(item.id); onClose() }}
          className="w-full rounded-xl border border-[#fee2e2] bg-[var(--color-background-primary)] py-2 text-xs font-semibold text-[#ef4444] transition hover:bg-[#fee2e2]">
          Delete task
        </button>
      </div>
    </div>
  )
}

// ─── Backlog view ─────────────────────────────────────────────────────────────

function BacklogView({ items, onSelect, activeId, onUpdate, onAddItem }: {
  items: WorkItem[]; onSelect: (item: WorkItem) => void; activeId: string | null
  onUpdate: (id: string, patch: Partial<WorkItem>) => void
  onAddItem: () => void
}) {
  const backlogItems = items.filter((i) => i.status === 'backlog')
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">Backlog <span className="ml-1 text-xs font-normal text-[var(--color-text-tertiary)]">({backlogItems.length})</span></p>
        <button onClick={onAddItem}
          className="rounded-xl bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
          + Add item
        </button>
      </div>
      <div className="space-y-2">
        {backlogItems.map((item) => (
          <button key={item.id} onClick={() => onSelect(item)}
            className={`flex w-full items-center gap-3 rounded-xl border bg-[var(--color-background-primary)] px-4 py-3 text-left transition hover:shadow-sm ${activeId === item.id ? 'border-[#93c5fd]' : 'border-[var(--color-border-secondary)]'}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[item.priority]}`} />
            <span className="text-sm">{TYPE_ICONS[item.type]}</span>
            <span className="flex-1 truncate text-sm text-[var(--color-text-primary)]">{item.title}</span>
            <div className="flex items-center gap-2">
              {item.tags.slice(0, 2).map((t) => (
                <span key={t} className="rounded-full bg-[var(--color-background-tertiary)] px-2 text-[10px] text-[var(--color-text-secondary)]">{t}</span>
              ))}
              <span className="text-[10px] text-[var(--color-text-tertiary)]">{timeAgo(item.updatedAt)}</span>
            </div>
          </button>
        ))}
        {backlogItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] py-12 text-center">
            <p className="text-sm text-[var(--color-text-tertiary)]">Backlog is clear</p>
            <p className="text-xs text-[#cbd5e1]">Add items to plan upcoming work</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sprints view ─────────────────────────────────────────────────────────────

function SprintsView({ sprints, items, projectId, onCreateSprint, onUpdateSprint, onDeleteSprint, onUpdateItem }: {
  sprints: Sprint[]; items: WorkItem[]; projectId?: string
  onCreateSprint: (name: string, pid: string, start?: string, end?: string) => Sprint
  onUpdateSprint: (id: string, patch: Partial<Sprint>) => void
  onDeleteSprint: (id: string) => void
  onUpdateItem: (id: string, patch: Partial<WorkItem>) => void
}) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')

  const projectSprints = sprints.filter((s) => !projectId || s.projectId === projectId)

  function handleCreate() {
    if (!newName.trim() || !projectId) return
    onCreateSprint(newName, projectId, newStart || undefined, newEnd || undefined)
    setNewName(''); setNewStart(''); setNewEnd(''); setShowNew(false)
  }

  const statusBadge = (s: Sprint['status']) => ({
    planned:   'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]',
    active:    'bg-[#dcfce7] text-[#166534]',
    completed: 'bg-[#e0e7ff] text-[#3730a3]',
  }[s])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">Sprints</p>
        {projectId && (
          <button onClick={() => setShowNew(true)}
            className="rounded-xl bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
            + New sprint
          </button>
        )}
      </div>

      {showNew && projectId && (
        <div className="mb-4 rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] p-4 space-y-3">
          <p className="text-xs font-semibold text-[#1d4ed8]">New Sprint</p>
          <input className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm outline-none focus:border-[#93c5fd]"
            placeholder="Sprint name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[var(--color-text-secondary)]">Start date</label>
              <input type="date" className="mt-0.5 w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs outline-none"
                value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] text-[var(--color-text-secondary)]">End date</label>
              <input type="date" className="mt-0.5 w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs outline-none"
                value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-1.5 text-xs text-[var(--color-text-secondary)]">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim()}
              className="rounded-lg bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Create</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {projectSprints.map((sprint) => {
          const sprintItems = items.filter((i) => i.sprintId === sprint.id)
          const done = sprintItems.filter((i) => i.status === 'done').length
          const pct = sprintItems.length > 0 ? Math.round((done / sprintItems.length) * 100) : 0
          return (
            <div key={sprint.id} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{sprint.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge(sprint.status)}`}>
                      {sprint.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{sprint.startAt?.slice(0,10)} → {sprint.endAt?.slice(0,10)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {sprint.status !== 'active' && sprint.status !== 'completed' && (
                    <button onClick={() => onUpdateSprint(sprint.id, { status: 'active' })}
                      className="rounded-lg bg-[#dcfce7] px-2.5 py-1 text-[10px] font-semibold text-[#166534] transition hover:bg-[#bbf7d0]">
                      Start
                    </button>
                  )}
                  {sprint.status === 'active' && (
                    <button onClick={() => onUpdateSprint(sprint.id, { status: 'completed' })}
                      className="rounded-lg bg-[#e0e7ff] px-2.5 py-1 text-[10px] font-semibold text-[#3730a3] transition hover:bg-[#c7d2fe]">
                      Complete
                    </button>
                  )}
                  <button onClick={() => onDeleteSprint(sprint.id)}
                    className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[10px] text-[var(--color-text-tertiary)] hover:border-[#fecaca] hover:text-[#ef4444]">
                    Delete
                  </button>
                </div>
              </div>
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{sprintItems.length} items · {done} done</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                  <div className="h-full rounded-full bg-[#22c55e] transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          )
        })}
        {projectSprints.length === 0 && !showNew && (
          <div className="rounded-2xl border border-dashed border-[var(--color-border-secondary)] py-12 text-center">
            <p className="text-sm text-[var(--color-text-tertiary)]">No sprints yet</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Quick-add form ───────────────────────────────────────────────────────────

function QuickAddForm({ defaultStatus, onAdd, onCancel }: {
  defaultStatus: WorkItemStatus
  onAdd: (title: string, status: WorkItemStatus) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-3 space-y-2">
      <input ref={inputRef}
        className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) onAdd(title, defaultStatus)
          if (e.key === 'Escape') onCancel()
        }} />
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">Cancel</button>
        <button onClick={() => { if (title.trim()) onAdd(title, defaultStatus) }}
          disabled={!title.trim()}
          className="rounded-lg bg-[#1d4ed8] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  )
}

// ─── New project form ─────────────────────────────────────────────────────────

function NewProjectForm({ onCreate, onCancel }: { onCreate: (name: string, desc: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  return (
    <div className="rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] p-4 space-y-3">
      <p className="text-xs font-semibold text-[#1d4ed8]">New Project</p>
      <input className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm outline-none focus:border-[#93c5fd]"
        placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name, desc) }} autoFocus />
      <input className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm outline-none focus:border-[#93c5fd]"
        placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-1.5 text-xs text-[var(--color-text-secondary)]">Cancel</button>
        <button onClick={() => { if (name.trim()) onCreate(name, desc) }} disabled={!name.trim()}
          className="rounded-lg bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Create</button>
      </div>
    </div>
  )
}

// ─── Main surface ─────────────────────────────────────────────────────────────

type ViewTab = 'board' | 'backlog' | 'sprints'

export function ProjectsSurface() {
  const {
    hydrated, items, sprints, projects, activeProject, setActiveProjectId,
    createItem, updateItem, deleteItem, moveItem,
    createSprint, updateSprint, deleteSprint,
    createProject,
  } = useWork()

  const [view, setView] = useState<ViewTab>('board')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickAddStatus, setQuickAddStatus] = useState<WorkItemStatus | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)

  const selectedItem = selectedId ? items.find((i) => i.id === selectedId) ?? null : null

  // Derive visible items: active project filter or all if no projects
  const visibleItems = activeProject
    ? items.filter((i) => !i.projectId || i.projectId === activeProject.id)
    : items

  function handleAddItem(status: WorkItemStatus) {
    setQuickAddStatus(status)
    setSelectedId(null)
  }

  function handleQuickAdd(title: string, status: WorkItemStatus) {
    const item = createItem({ title, status })
    setQuickAddStatus(null)
    setSelectedId(item.id)
  }

  function handleCreateProject(name: string, desc: string) {
    const p = createProject(name, desc)
    setActiveProjectId(p.id)
    setShowNewProject(false)
  }

  const tabs: { id: ViewTab; label: string }[] = [
    { id: 'board',    label: 'Board' },
    { id: 'backlog',  label: 'Backlog' },
    { id: 'sprints',  label: 'Sprints' },
  ]

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Left project list ── */}
      <aside className="flex w-48 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[#eaf1f8]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#1d4ed8]">Projects</span>
          <button onClick={() => setShowNewProject(true)} title="New project"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[#1d4ed8]">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {!hydrated && <p className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading…</p>}
          {hydrated && showNewProject && (
            <div className="p-1">
              <NewProjectForm onCreate={handleCreateProject} onCancel={() => setShowNewProject(false)} />
            </div>
          )}
          {hydrated && projects.length === 0 && !showNewProject && (
            <p className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">No projects yet</p>
          )}
          {/* All items (no project filter) */}
          {hydrated && (
            <button onClick={() => setActiveProjectId(null)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${!activeProject ? 'bg-[#dbeafe] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]'}`}>
              <span className="h-2 w-2 rounded-full bg-[#cbd5e1]" />
              All items
              <span className="ml-auto text-[10px]">{items.length}</span>
            </button>
          )}
          {projects.map((p) => {
            const count = items.filter((i) => i.projectId === p.id).length
            const isActive = activeProject?.id === p.id
            return (
              <button key={p.id} onClick={() => setActiveProjectId(p.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${isActive ? 'bg-[#dbeafe] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]'}`}>
                <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-[#1d4ed8]' : 'bg-[#cbd5e1]'}`} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-[10px]">{count}</span>
              </button>
            )
          })}
        </div>

        {/* External connectors footer */}
        <div className="border-t border-[var(--color-border-secondary)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">External</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {['Jira', 'Linear', 'GitHub'].map((c) => (
              <span key={c} className="rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">{c}</span>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-[#cbd5e1]">Import only — native is source of truth.</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-6 py-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{activeProject?.name ?? 'All items'}</p>
            {activeProject?.description && (
              <p className="text-xs text-[var(--color-text-tertiary)]">{activeProject.description}</p>
            )}
          </div>
          <div className="ml-4 flex gap-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setView(t.id)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${view === t.id ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {view === 'board' && (
            <button onClick={() => handleAddItem('todo')}
              className="ml-auto rounded-xl bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
              + New task
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Board view */}
          {view === 'board' && (
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
              <div className="flex h-full gap-3" style={{ minWidth: `${BOARD_COLUMNS.length * 260}px` }}>
                {BOARD_COLUMNS.map(({ status, label, color }) => {
                  const colItems = visibleItems.filter((i) => i.status === status)
                  return (
                    <div key={status} className="flex w-64 shrink-0 flex-col">
                      <BoardColumn status={status} label={label} color={color}
                        items={colItems}
                        activeId={selectedId}
                        onSelect={(item) => setSelectedId(item.id)}
                        onAddItem={(s) => { handleAddItem(s); setView('board') }} />
                      {quickAddStatus === status && (
                        <div className="mt-2 px-1">
                          <QuickAddForm defaultStatus={status}
                            onAdd={handleQuickAdd}
                            onCancel={() => setQuickAddStatus(null)} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Backlog view */}
          {view === 'backlog' && (
            <BacklogView items={visibleItems} activeId={selectedId}
              onSelect={(item) => setSelectedId(item.id)}
              onUpdate={updateItem}
              onAddItem={() => handleQuickAdd('New backlog item', 'backlog')} />
          )}

          {/* Sprints view */}
          {view === 'sprints' && (
            <SprintsView sprints={sprints} items={visibleItems}
              projectId={activeProject?.id}
              onCreateSprint={createSprint}
              onUpdateSprint={updateSprint}
              onDeleteSprint={deleteSprint}
              onUpdateItem={updateItem} />
          )}

          {/* Task detail panel */}
          {selectedItem && (
            <TaskDetail item={selectedItem}
              onUpdate={updateItem}
              onDelete={(id) => { deleteItem(id); setSelectedId(null) }}
              onMove={moveItem}
              onClose={() => setSelectedId(null)} />
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useProjects } from '@/lib/projects/useProjects'
import { PROJECT_COLORS } from '@/lib/projects/types'
import type { Project, ProjectColor } from '@/lib/projects/types'
import type { PendingAttachment, AttachmentKind } from '@/lib/types/attachment'

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function detectKind(mimeType: string, name: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'c', 'cpp', 'java', 'rb', 'php', 'swift', 'kt', 'cs', 'json', 'yaml', 'yml', 'toml']
  if (codeExts.includes(ext)) return 'code'
  const textExts = ['txt', 'md', 'csv', 'log']
  if (textExts.includes(ext)) return 'text'
  return 'binary'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

// ─── Color picker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: ProjectColor; onChange: (c: ProjectColor) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{ backgroundColor: c }}
          className={`h-5 w-5 rounded-full transition-transform ${value === c ? 'scale-125 ring-2 ring-offset-1 ring-[var(--color-border-secondary)]' : 'hover:scale-110'}`}
          aria-label={c}
        />
      ))}
    </div>
  )
}

// ─── Project detail editor ────────────────────────────────────────────────────

type EditorTab = 'prompt' | 'files' | 'settings'

function ProjectEditor({
  project,
  onUpdate,
  onDelete,
  onActivate,
  isActive,
}: {
  project: Project
  onUpdate: (patch: Partial<Project>) => void
  onDelete: () => void
  onActivate: () => void
  isActive: boolean
}) {
  const [tab, setTab] = useState<EditorTab>('prompt')
  const [title, setTitle] = useState(project.title)
  const [desc, setDesc] = useState(project.description)
  const [color, setColor] = useState<ProjectColor>(project.color)
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [filesDragOver, setFilesDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitle(project.title)
    setDesc(project.description)
    setColor(project.color)
    setSystemPrompt(project.systemPrompt)
  }, [project.id, project.title, project.description, project.color, project.systemPrompt])

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    for (const file of files) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1] ?? ''
        const att: PendingAttachment = {
          clientId: crypto.randomUUID(),
          name: file.name,
          kind: detectKind(file.type, file.name),
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          sizeLabel: formatBytes(file.size),
          base64,
        }
        onUpdate({ fileAttachments: [...(project.fileAttachments ?? []), att] })
      }
      reader.readAsDataURL(file)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeAttachment(clientId: string) {
    onUpdate({ fileAttachments: project.fileAttachments.filter((a) => a.clientId !== clientId) })
  }

  // Auto-save on changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      onUpdate({ title: title.trim() || project.title, description: desc, color, systemPrompt })
    }, 500)
    return () => clearTimeout(timeout)
  }, [title, desc, color, systemPrompt])

  const tabs: { id: EditorTab; label: string }[] = [
    { id: 'prompt', label: 'System Prompt' },
    { id: 'files',  label: 'Files' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Editor header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
          <span className="text-[15px] font-bold text-[var(--color-text-primary)]">{project.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-2.5 py-1.5 rounded-lg border border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)] text-xs transition hover:border-[#fecaca] hover:text-[#ef4444]"
          >
            Delete
          </button>
          <button
            onClick={onActivate}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${isActive ? 'bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0]' : 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]'}`}
          >
            {isActive ? 'Deactivate' : 'Set active'}
          </button>
        </div>
      </div>

      {/* Delete confirm banner */}
      {confirmDelete && (
        <div className="flex items-center justify-between bg-[#FEF3C7] border-b border-[#FCD34D] px-6 py-2.5">
          <span className="text-xs text-[#92400e]">Delete {project.title}? This can&apos;t be undone.</span>
          <div className="flex shrink-0 gap-3">
            <button onClick={() => setConfirmDelete(false)} className="text-xs font-semibold text-[#92400e] hover:underline">Cancel</button>
            <button onClick={onDelete} className="text-xs font-semibold text-[#dc2626] hover:underline">Delete</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-secondary)] px-6 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-5 py-1.5 text-xs font-medium transition ${tab === t.id ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === 'prompt' && (
          <div className="flex h-full flex-col gap-3">
            <div className="bg-[var(--color-background-secondary)] border border-[var(--color-border-secondary)] rounded-[9px] p-3">
              <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                Prepended to every conversation while this project is active.
              </p>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="flex-1 min-h-[360px] resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 text-[13px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--accent)]"
              placeholder={`You are an expert assistant for ${project.title}.\n\nContext:\n- ...\n\nAlways:\n- Respond concisely\n- Use domain-specific terminology\n\nNever:\n- Guess at requirements\n- Skip reasoning steps`}
            />
            <div className="flex items-center">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{systemPrompt.length} characters</span>
            </div>
          </div>
        )}

        {tab === 'files' && (
          <div className="space-y-4">
            <div className="bg-[var(--color-background-secondary)] border border-[var(--color-border-secondary)] rounded-[9px] p-3">
              <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                Files attached here are injected verbatim — not chunked or retrieved. Keep them small.
              </p>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setFilesDragOver(true) }}
              onDragLeave={() => setFilesDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setFilesDragOver(false)
                if (e.dataTransfer.files.length) handleFilePick({ target: { files: e.dataTransfer.files, value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-xs transition ${filesDragOver ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}
            >
              + Attach files, or drop them here
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFilePick} />
            {project.fileAttachments.length === 0 ? (
              <p className="text-center text-xs text-[var(--color-text-tertiary)]">No files attached yet</p>
            ) : (
              <div className="space-y-2">
                {project.fileAttachments.map((att) => (
                  <div key={att.clientId} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2">
                    <span className="text-base">{att.kind === 'image' ? '🖼' : att.kind === 'pdf' ? '📄' : att.kind === 'code' ? '⌥' : '📝'}</span>
                    <span className="flex-1 truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{att.name}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{att.sizeLabel}</span>
                    <button onClick={() => removeAttachment(att.clientId)} className="text-[var(--color-text-tertiary)] hover:text-[#ef4444]">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Name</p>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] outline-none focus:border-[var(--accent)]"
                placeholder="Project name…"
              />
            </div>
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Description</p>
              <textarea
                rows={3}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--accent)] resize-none"
                placeholder="What is this project about?"
              />
            </div>
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Colour</p>
              <ColorPicker value={color} onChange={(c) => { setColor(c); onUpdate({ color: c }) }} />
            </div>
            <div className="pt-1">
              <p className="select-text font-mono text-[10.5px] text-[var(--color-text-tertiary)]">ID: {project.id}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ProjectsPanel({
  projects, activeProjectId, activeProject, createProject, updateProject, deleteProject, setActiveProject,
}: {
  projects: ReturnType<typeof useProjects>['projects']
  activeProjectId: ReturnType<typeof useProjects>['activeProjectId']
  activeProject: ReturnType<typeof useProjects>['activeProject']
  createProject: ReturnType<typeof useProjects>['createProject']
  updateProject: ReturnType<typeof useProjects>['updateProject']
  deleteProject: ReturnType<typeof useProjects>['deleteProject']
  setActiveProject: ReturnType<typeof useProjects>['setActiveProject']
}) {
  const [selectedId, setSelectedId] = useState<string | null>(activeProjectId)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newColor, setNewColor] = useState<ProjectColor>(PROJECT_COLORS[0])

  // Keep selected in sync with active project changes
  useEffect(() => {
    if (activeProjectId) setSelectedId(activeProjectId)
  }, [activeProjectId])

  // Auto-select first project
  useEffect(() => {
    if (!selectedId && projects.length > 0) setSelectedId(projects[0].id)
  }, [projects, selectedId])

  const selectedProject = selectedId ? projects.find((p) => p.id === selectedId) ?? null : null

  function handleCreate() {
    if (!newTitle.trim()) return
    const p = createProject({ title: newTitle.trim(), description: newDesc.trim(), color: newColor })
    setActiveProject(p.id)
    setSelectedId(p.id)
    setShowCreate(false)
    setNewTitle('')
    setNewDesc('')
    setNewColor(PROJECT_COLORS[0])
  }

  function handleActivate(project: Project) {
    const willActivate = activeProjectId !== project.id
    setActiveProject(willActivate ? project.id : null)
  }

  function handleUpdate(id: string, patch: Partial<Project>) {
    updateProject(id, patch)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — project list */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Projects</span>
          <button
            onClick={() => setShowCreate(true)}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[var(--accent)] text-white transition hover:opacity-90"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {showCreate && (
          <div className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-3 space-y-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
              className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-white px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--accent)]"
              placeholder="Project name…"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
              className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-white px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--accent)]"
              placeholder="Description (optional)…"
            />
            <ColorPicker value={newColor} onChange={setNewColor} />
            <div className="flex gap-1.5">
              <button onClick={handleCreate} className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white">Create</button>
              <button onClick={() => setShowCreate(false)} className="rounded-lg border border-[var(--color-border-secondary)] bg-white px-3 py-1 text-xs text-[var(--color-text-secondary)]">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {projects.length === 0 && !showCreate && (
            <p className="py-6 text-center text-xs text-[var(--color-text-tertiary)]">No projects yet</p>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${selectedId === p.id ? 'bg-[var(--accent-soft)] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]'}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{p.title}</span>
                <span className="block truncate text-[10px] font-normal text-[var(--color-text-tertiary)]">
                  {p.fileAttachments.length} {p.fileAttachments.length === 1 ? 'file' : 'files'}
                </span>
              </span>
              {p.id === activeProjectId && (
                <span className="shrink-0 h-[7px] w-[7px] rounded-full bg-[#10B981]" title="Active" />
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-[var(--color-border-secondary)] px-3 py-2">
          {activeProject ? (
            <div className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#10B981]" />
              <span className="truncate text-[11px] font-semibold text-[#059669]">Active: {activeProject.title}</span>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-text-tertiary)]">No project active</p>
          )}
        </div>
      </aside>

      {/* Right — editor */}
      {selectedProject ? (
        <ProjectEditor
          key={selectedProject.id}
          project={selectedProject}
          isActive={selectedProject.id === activeProjectId}
          onUpdate={(patch) => handleUpdate(selectedProject.id, patch)}
          onDelete={() => {
            deleteProject(selectedProject.id)
            setSelectedId(projects.find((p) => p.id !== selectedProject.id)?.id ?? null)
          }}
          onActivate={() => handleActivate(selectedProject)}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
          <div className="text-3xl">📁</div>
          <p className="text-xs text-[var(--color-text-tertiary)]">Select a project to edit it</p>
        </div>
      )}
    </div>
  )
}

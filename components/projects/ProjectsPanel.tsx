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
    <div className="flex gap-1.5 flex-wrap">
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
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setTitle(project.title)
    setDesc(project.description)
    setColor(project.color)
    setSystemPrompt(project.systemPrompt)
  }, [project.id, project.title, project.description, project.color, project.systemPrompt])

  function save() {
    onUpdate({ title: title.trim() || project.title, description: desc, color, systemPrompt })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // Read every file first, THEN append once. The old per-file onload each wrote
    // `[...stale, oneFile]` from the render-time prop, so the last callback to
    // resolve clobbered the rest — only one file ever persisted.
    const results = await Promise.all(
      files.map(
        (file) =>
          new Promise<PendingAttachment | null>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1] ?? ''
              resolve({
                clientId: crypto.randomUUID(),
                name: file.name,
                kind: detectKind(file.type, file.name),
                mimeType: file.type || 'application/octet-stream',
                sizeBytes: file.size,
                sizeLabel: formatBytes(file.size),
                base64,
              })
            }
            reader.onerror = () => resolve(null) // skip an unreadable file, keep the rest
            reader.readAsDataURL(file)
          }),
      ),
    )
    const atts = results.filter((a): a is PendingAttachment => a !== null)
    if (atts.length) onUpdate({ fileAttachments: [...(project.fileAttachments ?? []), ...atts] })
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeAttachment(clientId: string) {
    onUpdate({ fileAttachments: project.fileAttachments.filter((a) => a.clientId !== clientId) })
  }

  const tabs: { id: EditorTab; label: string }[] = [
    { id: 'prompt', label: 'System Prompt' },
    { id: 'files',  label: `Files${project.fileAttachments.length ? ` (${project.fileAttachments.length})` : ''}` },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Editor header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{project.title}</span>
          {isActive && (
            <span className="rounded-md bg-[#dbeafe] px-1.5 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">Active</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-[var(--color-accent)]">Saved</span>}
          <button
            onClick={onActivate}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${isActive ? 'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]' : 'bg-[#1d4ed8] text-white hover:bg-[#1e40af]'}`}
          >
            {isActive ? 'Active' : 'Set active'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-secondary)] px-6 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3 py-1.5 text-xs font-medium transition ${tab === t.id ? 'border-b-2 border-[#1d4ed8] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === 'prompt' && (
          <div className="flex h-full flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">System Prompt</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-tertiary)]">
                Prepended to every conversation while this project is active. Sets role, constraints, tone, and domain context.
              </p>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="flex-1 min-h-[360px] resize-none rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 font-mono text-xs leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
              placeholder={`You are an expert assistant for ${project.title}.\n\nContext:\n- ...\n\nAlways:\n- Respond concisely\n- Use domain-specific terminology\n\nNever:\n- Guess at requirements\n- Skip reasoning steps`}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{systemPrompt.length} chars</span>
              <div className="flex gap-2">
                {systemPrompt.trim() && (
                  <button onClick={() => setSystemPrompt('')} className="text-xs text-[var(--color-text-tertiary)] hover:text-[#ef4444]">Clear</button>
                )}
                <button onClick={save} className="rounded-xl bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'files' && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Project Files</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-tertiary)]">
                Files attached here are injected into every conversation in this project as context.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border-secondary)] py-4 text-xs text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]"
              >
                + Attach files
              </button>
              <button
                onClick={() => folderRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border-secondary)] py-4 text-xs text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]"
              >
                + Attach a folder
              </button>
            </div>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFilePick} />
            {/* folder picker — set the non-standard directory attributes via a callback ref */}
            <input
              ref={(el) => { folderRef.current = el; if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', '') } }}
              type="file" multiple className="hidden" onChange={handleFilePick}
            />
            {project.fileAttachments.length === 0 ? (
              <p className="text-center text-xs text-[var(--color-text-tertiary)]">No files attached yet</p>
            ) : (
              <div className="space-y-2">
                {project.fileAttachments.map((att) => (
                  <div key={att.clientId} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2">
                    <span className="text-base">{att.kind === 'image' ? '🖼' : att.kind === 'pdf' ? '📄' : att.kind === 'code' ? '⌥' : '📝'}</span>
                    <span className="flex-1 truncate text-xs font-medium text-[var(--color-text-primary)]">{att.name}</span>
                    <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{att.sizeLabel}</span>
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
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Name</p>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] outline-none focus:border-[#93c5fd]"
                placeholder="Project name…"
              />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Description</p>
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
                placeholder="What is this project about?"
              />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Color</p>
              <ColorPicker value={color} onChange={(c) => { setColor(c); onUpdate({ color: c }) }} />
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={save}
                className="rounded-xl bg-[#1d4ed8] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af]"
              >
                Save changes
              </button>
              <button
                onClick={() => {
                  if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000) }
                  else onDelete()
                }}
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${confirmDelete ? 'bg-[#fef2f2] text-[#dc2626]' : 'border border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)] hover:border-[#fecaca] hover:text-[#ef4444]'}`}
              >
                {confirmDelete ? 'Confirm delete?' : 'Delete project'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ProjectsPanel({
  onProjectActivate,
}: {
  onProjectActivate?: (systemPrompt: string) => void
}) {
  const { projects, activeProjectId, activeProject, createProject, updateProject, deleteProject, setActiveProject } = useProjects()
  const [selectedId, setSelectedId] = useState<string | null>(activeProjectId)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
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
    const p = createProject({ title: newTitle.trim(), color: newColor })
    setActiveProject(p.id)
    setSelectedId(p.id)
    onProjectActivate?.(p.systemPrompt)
    setShowCreate(false)
    setNewTitle('')
    setNewColor(PROJECT_COLORS[0])
  }

  function handleActivate(project: Project) {
    const willActivate = activeProjectId !== project.id
    setActiveProject(willActivate ? project.id : null)
    onProjectActivate?.(willActivate ? project.systemPrompt : '')
  }

  function handleUpdate(id: string, patch: Partial<Project>) {
    updateProject(id, patch)
    if (activeProjectId === id && patch.systemPrompt !== undefined) {
      onProjectActivate?.(patch.systemPrompt)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — project list */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[#eaf1f8]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
          <span className="text-xs font-semibold text-[#1d4ed8]">Projects</span>
          <button
            onClick={() => setShowCreate(true)}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[#1d4ed8]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {showCreate && (
          <div className="border-b border-[#bfdbfe] bg-[#eff6ff] px-3 py-3 space-y-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
              className="w-full rounded-lg border border-[#bfdbfe] bg-white px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8]"
              placeholder="Project name…"
            />
            <ColorPicker value={newColor} onChange={setNewColor} />
            <div className="flex gap-1.5">
              <button onClick={handleCreate} className="rounded-lg bg-[#1d4ed8] px-3 py-1 text-xs font-semibold text-white">Create</button>
              <button onClick={() => setShowCreate(false)} className="rounded-lg border border-[#bfdbfe] bg-white px-3 py-1 text-xs text-[var(--color-text-secondary)]">Cancel</button>
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
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${selectedId === p.id ? 'bg-[#dbeafe] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]'}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="flex-1 truncate">{p.title}</span>
              {p.id === activeProjectId && (
                <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" title="Active" />
              )}
            </button>
          ))}
        </div>

        {activeProject && (
          <div className="border-t border-[var(--color-border-secondary)] px-3 py-2">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">Active:</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: activeProject.color }} />
              <span className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{activeProject.title}</span>
            </div>
          </div>
        )}
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
          <div className="text-3xl">📁</div>
          <p className="text-sm font-semibold text-[var(--color-text-secondary)]">No project selected</p>
          <p className="text-xs text-[var(--color-text-tertiary)] max-w-xs leading-5">
            Projects let you set a persistent system prompt, attach reference files, and scope memory to a specific context.
          </p>
          <button onClick={() => setShowCreate(true)} className="mt-2 rounded-xl bg-[#1d4ed8] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
            Create first project
          </button>
        </div>
      )}
    </div>
  )
}

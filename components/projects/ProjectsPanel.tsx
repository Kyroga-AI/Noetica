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
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            backgroundColor: c,
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            transition: 'transform 0.15s',
            transform: value === c ? 'scale(1.25)' : undefined,
            outline: value === c ? '2px solid var(--color-border-secondary)' : 'none',
            outlineOffset: '1px',
          }}
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border-secondary)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: project.color, flexShrink: 0 }} />
        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary)', flex: 1 }}>{project.title}</span>
        <button
          onClick={onActivate}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: isActive ? 'none' : 'none',
            background: isActive ? '#dcfce7' : 'var(--accent)',
            color: isActive ? '#15803d' : '#fff',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isActive ? 'Deactivate' : 'Set active'}
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid var(--color-border-secondary)',
            background: 'none',
            color: 'var(--color-text-tertiary)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>

      {/* Delete confirm banner */}
      {confirmDelete && (
        <div style={{ padding: '10px 20px', background: '#FEF3C7', borderBottom: '1px solid #FCD34D', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: '#92400E', flex: 1 }}>Delete &ldquo;{project.title}&rdquo;? This can&apos;t be undone.</span>
          <span onClick={() => { onDelete() }} style={{ fontSize: '13px', fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>Delete</span>
          <span onClick={() => setConfirmDelete(false)} style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</span>
        </div>
      )}

      {/* Tab strip */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border-secondary)', padding: '0 20px', flexShrink: 0 }}>
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '9px 14px 8px',
              fontSize: '12.5px',
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? 'var(--accent)' : 'var(--color-text-secondary)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              cursor: 'pointer',
              marginBottom: '-1px',
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Tab: System Prompt */}
      {tab === 'prompt' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', gap: '10px', overflowY: 'auto' }}>
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', lineHeight: 1.6, padding: '10px 12px', background: 'var(--color-background-secondary)', borderRadius: '9px', border: '1px solid var(--color-border-secondary)' }}>
            Prepended to every conversation while this project is active. Use it to set persona, constraints, or domain knowledge.
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="e.g. You are helping with Client X's website rebuild. Always reference their existing brand guidelines..."
            rows={14}
            style={{
              flex: 1,
              border: '1px solid var(--color-border-secondary)',
              borderRadius: '10px',
              padding: '12px 14px',
              fontSize: '13px',
              lineHeight: 1.7,
              color: 'var(--color-text-primary)',
              background: 'var(--color-background-primary)',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{systemPrompt.length} characters</div>
        </div>
      )}

      {/* Tab: Files */}
      {tab === 'files' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', lineHeight: 1.6, padding: '10px 12px', background: 'var(--color-background-secondary)', borderRadius: '9px', border: '1px solid var(--color-border-secondary)' }}>
            Files attached here are injected verbatim into every conversation — not chunked or retrieved. Keep them small (brand guidelines, glossaries, key specs).
          </div>
          {project.fileAttachments.map((att) => (
            <div key={att.clientId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '9px', background: 'var(--color-background-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <div style={{ fontSize: '18px' }}>&#128196;</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{att.sizeLabel}</div>
              </div>
              <div onClick={() => removeAttachment(att.clientId)} style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', cursor: 'pointer', opacity: 0.6 }}>&times;</div>
            </div>
          ))}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setFilesDragOver(true) }}
            onDragLeave={() => setFilesDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setFilesDragOver(false)
              if (e.dataTransfer.files.length) handleFilePick({ target: { files: e.dataTransfer.files, value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
            }}
            style={{
              border: `1.5px dashed ${filesDragOver ? 'var(--accent)' : 'var(--color-border-secondary)'}`,
              borderRadius: '10px',
              padding: '24px',
              textAlign: 'center',
              color: 'var(--color-text-tertiary)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '22px', marginBottom: '8px' }}>+</div>
            Attach a file
          </div>
          <input ref={fileRef} type="file" multiple onChange={handleFilePick} style={{ display: 'none' }} />
        </div>
      )}

      {/* Tab: Settings */}
      {tab === 'settings' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border-secondary)', borderRadius: '9px', padding: '8px 12px', fontSize: '13.5px', color: 'var(--color-text-primary)', background: 'var(--color-background-primary)', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border-secondary)', borderRadius: '9px', padding: '8px 12px', fontSize: '13px', color: 'var(--color-text-primary)', background: 'var(--color-background-primary)', outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Colour</div>
            <ColorPicker value={color} onChange={(c) => { setColor(c); onUpdate({ color: c }) }} />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>ID: {project.id}</div>
        </div>
      )}
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
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Left sidebar — project list */}
      <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid var(--color-border-secondary)', display: 'flex', flexDirection: 'column', background: 'var(--color-background-secondary)' }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--color-border-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--color-text-secondary)', flex: 1 }}>Projects</span>
          <div
            onClick={() => setShowCreate(true)}
            style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', cursor: 'pointer', lineHeight: 1 }}
          >+</div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
              placeholder="Project name"
              style={{ border: '1px solid var(--color-border-secondary)', borderRadius: '7px', padding: '6px 9px', fontSize: '12.5px', color: 'var(--color-text-primary)', background: 'var(--color-background-secondary)', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
              placeholder="Description (optional)"
              style={{ border: '1px solid var(--color-border-secondary)', borderRadius: '7px', padding: '6px 9px', fontSize: '12px', color: 'var(--color-text-primary)', background: 'var(--color-background-secondary)', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <div onClick={handleCreate} style={{ flex: 1, padding: '6px', borderRadius: '7px', background: 'var(--accent)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', textAlign: 'center' }}>Create</div>
              <div onClick={() => setShowCreate(false)} style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' }}>Cancel</div>
            </div>
          </div>
        )}

        {/* Project list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                padding: '8px 10px',
                borderRadius: '9px',
                cursor: 'pointer',
                background: selectedId === p.id ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: p.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                <div style={{ fontSize: '10.5px', color: 'var(--color-text-tertiary)' }}>{timeAgo(p.updatedAt)}</div>
              </div>
              {p.id === activeProjectId && (
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
              )}
            </div>
          ))}
          {projects.length === 0 && !showCreate && (
            <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--color-text-tertiary)', fontSize: '12px' }}>No projects yet</div>
          )}
        </div>

        {/* Footer: active project indicator */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border-secondary)' }}>
          {activeProject ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Active: {activeProject.title}</span>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>No project active</div>
          )}
        </div>
      </div>

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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--color-text-tertiary)' }}>
          <div style={{ fontSize: '28px' }}>&#128450;</div>
          <div style={{ fontSize: '13px' }}>Select a project to edit it</div>
        </div>
      )}
    </div>
  )
}

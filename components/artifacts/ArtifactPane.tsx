'use client'

import { useState } from 'react'
import type { Artifact } from '@/lib/types/artifact'
import { artifactTypeLabel, artifactTypeIcon, LANGUAGE_LABELS } from '@/lib/types/artifact'

type ArtifactPaneProps = {
  artifact: Artifact
  onClose: () => void
  onUpdate: (id: string, patch: Partial<Artifact>) => void
  onDelete: (id: string) => void
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function CodeRenderer({ artifact }: { artifact: Artifact }) {
  const [copied, setCopied] = useState(false)
  const lang = artifact.language ?? 'other'

  function copy() {
    navigator.clipboard.writeText(artifact.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {LANGUAGE_LABELS[lang] ?? lang}
        </span>
        <button
          onClick={copy}
          className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#0f172a] p-4">
        <pre className="text-xs leading-6 text-[#e2e8f0] whitespace-pre-wrap break-all font-mono">
          {artifact.content}
        </pre>
      </div>
    </div>
  )
}

function HtmlRenderer({ artifact }: { artifact: Artifact }) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2">
        {(['preview', 'source'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition capitalize ${
              mode === m ? 'bg-[var(--color-background-primary)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === 'preview' ? (
        <iframe
          srcDoc={artifact.content}
          sandbox="allow-scripts"
          className="min-h-0 flex-1 border-0 bg-[var(--color-background-primary)]"
          title={artifact.title}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[#0f172a] p-4">
          <pre className="text-xs leading-6 text-[#e2e8f0] whitespace-pre-wrap font-mono">
            {artifact.content}
          </pre>
        </div>
      )}
    </div>
  )
}

function DocumentRenderer({ artifact, onUpdate }: { artifact: Artifact; onUpdate: (id: string, patch: Partial<Artifact>) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(artifact.content)

  function save() {
    onUpdate(artifact.id, { content: draft })
    setEditing(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2">
        <span className="text-xs text-[var(--color-text-secondary)]">Markdown document</span>
        <div className="flex gap-1.5">
          {editing ? (
            <>
              <button onClick={save} className="rounded-lg bg-[#1d4ed8] px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[#1e40af]">Save</button>
              <button onClick={() => { setDraft(artifact.content); setEditing(false) }} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">Edit</button>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-0 flex-1 resize-none bg-[var(--color-background-primary)] p-4 font-mono text-xs text-[var(--color-text-primary)] outline-none"
          spellCheck={false}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="prose prose-sm max-w-none text-[var(--color-text-secondary)]">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7">{artifact.content}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function DataRenderer({ artifact }: { artifact: Artifact }) {
  let parsed: unknown = null
  let parseError = ''
  try { parsed = JSON.parse(artifact.content) } catch (e) { parseError = String(e) }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2">
        <span className="text-xs text-[var(--color-text-secondary)]">JSON / Data</span>
      </div>
      {parseError ? (
        <div className="p-4 text-xs text-[#ef4444]">{parseError}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[#0f172a] p-4">
          <pre className="text-xs leading-6 text-[#e2e8f0] font-mono">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function GenericRenderer({ artifact }: { artifact: Artifact }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <pre className="whitespace-pre-wrap text-xs leading-6 text-[var(--color-text-secondary)] font-mono">{artifact.content}</pre>
    </div>
  )
}

function ArtifactRenderer({ artifact, onUpdate }: { artifact: Artifact; onUpdate: (id: string, patch: Partial<Artifact>) => void }) {
  switch (artifact.type) {
    case 'code':    return <CodeRenderer artifact={artifact} />
    case 'html':    return <HtmlRenderer artifact={artifact} />
    case 'document': return <DocumentRenderer artifact={artifact} onUpdate={onUpdate} />
    case 'data':    return <DataRenderer artifact={artifact} />
    default:        return <GenericRenderer artifact={artifact} />
  }
}

// ─── Pane shell ───────────────────────────────────────────────────────────────

function artifactExtension(artifact: Artifact): string {
  if (artifact.type === 'html')     return '.html'
  if (artifact.type === 'document') return '.md'
  if (artifact.type === 'data')     return '.json'
  if (artifact.type === 'code') {
    const ext: Record<string, string> = { python: '.py', typescript: '.ts', javascript: '.js', rust: '.rs', go: '.go', css: '.css', sql: '.sql', bash: '.sh', yaml: '.yaml', toml: '.toml' }
    return ext[artifact.language ?? ''] ?? '.txt'
  }
  return '.txt'
}

export function ArtifactPane({ artifact, onClose, onUpdate, onDelete }: ArtifactPaneProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return }
    onDelete(artifact.id)
    onClose()
  }

  function handleDownload() {
    const ext = artifactExtension(artifact)
    const slug = artifact.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artifact'
    const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-secondary)] px-4 py-3">
        <span className="text-base">{artifactTypeIcon(artifact.type)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{artifact.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">{artifactTypeLabel(artifact.type)}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--color-border-secondary)]" />
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
              artifact.status === 'final' ? 'bg-[#dcfce7] text-[#16a34a]' :
              artifact.status === 'archived' ? 'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]' :
              'bg-[#fef9c3] text-[#92400e]'
            }`}>
              {artifact.status}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {artifact.status === 'draft' && (
            <button
              onClick={() => onUpdate(artifact.id, { status: 'final' })}
              className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-[10px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]"
            >
              Finalise
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-secondary)]"
            title="Download"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1v7M3 5.5l3 3 3-3M2 10.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
              confirmDelete
                ? 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]'
                : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)] hover:text-[#ef4444]'
            }`}
          >
            {confirmDelete ? 'Confirm?' : 'Delete'}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-secondary)]"
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Content renderer */}
      <ArtifactRenderer artifact={artifact} onUpdate={onUpdate} />

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2 text-[10px] text-[var(--color-text-tertiary)]">
        Created {new Date(artifact.createdAt).toLocaleString()} · Updated {new Date(artifact.updatedAt).toLocaleString()}
        {artifact.tags.length > 0 && (
          <span className="ml-2">{artifact.tags.map((t) => `#${t}`).join(' ')}</span>
        )}
      </div>
    </div>
  )
}

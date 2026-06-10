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
      <div className="flex items-center justify-between border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2">
        <span className="text-xs font-medium text-[#64748b]">
          {LANGUAGE_LABELS[lang] ?? lang}
        </span>
        <button
          onClick={copy}
          className="rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs font-medium text-[#334155] transition hover:bg-[#f1f5f9]"
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
      <div className="flex items-center gap-1 border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2">
        {(['preview', 'source'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition capitalize ${
              mode === m ? 'bg-white shadow-sm text-[#0f172a]' : 'text-[#64748b] hover:text-[#0f172a]'
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
          className="min-h-0 flex-1 border-0 bg-white"
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
      <div className="flex items-center justify-between border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2">
        <span className="text-xs text-[#64748b]">Markdown document</span>
        <div className="flex gap-1.5">
          {editing ? (
            <>
              <button onClick={save} className="rounded-lg bg-[#1d4ed8] px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[#1e40af]">Save</button>
              <button onClick={() => { setDraft(artifact.content); setEditing(false) }} className="rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs font-medium text-[#334155] transition hover:bg-[#f1f5f9]">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs font-medium text-[#334155] transition hover:bg-[#f1f5f9]">Edit</button>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-0 flex-1 resize-none bg-white p-4 font-mono text-xs text-[#0f172a] outline-none"
          spellCheck={false}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="prose prose-sm max-w-none text-[#334155]">
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
      <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2">
        <span className="text-xs text-[#64748b]">JSON / Data</span>
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
      <pre className="whitespace-pre-wrap text-xs leading-6 text-[#334155] font-mono">{artifact.content}</pre>
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

export function ArtifactPane({ artifact, onClose, onUpdate, onDelete }: ArtifactPaneProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return }
    onDelete(artifact.id)
    onClose()
  }

  return (
    <div className="flex h-full flex-col border-l border-[#d7dee8] bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#d7dee8] px-4 py-3">
        <span className="text-base">{artifactTypeIcon(artifact.type)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#0f172a]">{artifact.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-[#94a3b8]">{artifactTypeLabel(artifact.type)}</span>
            <span className="h-1 w-1 rounded-full bg-[#d7dee8]" />
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
              artifact.status === 'final' ? 'bg-[#dcfce7] text-[#16a34a]' :
              artifact.status === 'archived' ? 'bg-[#f1f5f9] text-[#64748b]' :
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
            onClick={handleDelete}
            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
              confirmDelete
                ? 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]'
                : 'border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8] hover:text-[#ef4444]'
            }`}
          >
            {confirmDelete ? 'Confirm?' : 'Delete'}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#94a3b8] transition hover:bg-[#f1f5f9] hover:text-[#334155]"
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
      <div className="shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] px-4 py-2 text-[10px] text-[#94a3b8]">
        Created {new Date(artifact.createdAt).toLocaleString()} · Updated {new Date(artifact.updatedAt).toLocaleString()}
        {artifact.tags.length > 0 && (
          <span className="ml-2">{artifact.tags.map((t) => `#${t}`).join(' ')}</span>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useArtifacts } from '@/lib/artifacts/useArtifacts'
import { ArtifactPane } from '@/components/artifacts/ArtifactPane'
import type { Artifact, ArtifactType } from '@/lib/types/artifact'
import { artifactTypeLabel, artifactTypeIcon } from '@/lib/types/artifact'

const TYPE_FILTERS: { type: ArtifactType | 'all'; label: string }[] = [
  { type: 'all',           label: 'All' },
  { type: 'document',      label: 'Documents' },
  { type: 'code',          label: 'Code' },
  { type: 'html',          label: 'HTML' },
  { type: 'evidence',      label: 'Evidence' },
  { type: 'data',          label: 'Data' },
  { type: 'sourceos_event', label: 'SourceOS events' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function ArtifactsSurface() {
  const { hydrated, artifacts, createArtifact, updateArtifact, deleteArtifact } = useArtifacts()
  const [filter, setFilter] = useState<ArtifactType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<ArtifactType>('document')
  const [newContent, setNewContent] = useState('')

  const selectedArtifact = selectedId ? artifacts.find((a) => a.id === selectedId) ?? null : null

  const filtered = artifacts.filter((a) => {
    if (filter !== 'all' && a.type !== filter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)
    }
    return true
  })

  const typeCounts = TYPE_FILTERS.slice(1).map(({ type, label }) => ({
    type, label,
    count: artifacts.filter((a) => a.type === type).length,
  }))

  function handleCreate() {
    if (!newTitle.trim()) return
    const a = createArtifact({ type: newType, title: newTitle.trim(), content: newContent })
    setSelectedId(a.id)
    setShowNewForm(false)
    setNewTitle('')
    setNewContent('')
    setNewType('document')
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left column: browser */}
      <div className={`flex flex-col ${selectedArtifact ? 'w-[420px] shrink-0' : 'flex-1'} min-h-0 overflow-hidden`}>
        {/* Toolbar */}
        <div className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">Artifacts</div>
              <div className="text-xs text-[var(--color-text-secondary)]">{artifacts.length} total</div>
            </div>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-40 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
              />
              <button
                onClick={() => setShowNewForm(true)}
                className="rounded-xl bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e293b]"
              >
                + New
              </button>
            </div>
          </div>

          {/* Type filter tabs */}
          <div className="mt-2.5 flex gap-0.5 overflow-x-auto">
            {TYPE_FILTERS.map(({ type, label }) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition ${
                  filter === type ? 'bg-[#dbeafe] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* New artifact form */}
        {showNewForm && (
          <div className="border-b border-[#bfdbfe] bg-[#eff6ff] px-5 py-4 space-y-2.5">
            <div className="text-xs font-semibold text-[#1d4ed8]">New artifact</div>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title…"
              className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs outline-none focus:border-[#1d4ed8]"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as ArtifactType)}
              className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs outline-none"
            >
              {TYPE_FILTERS.slice(1).map(({ type, label }) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Content (optional — you can edit after creation)…"
              rows={4}
              className="w-full resize-none rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-xs outline-none focus:border-[#1d4ed8]"
            />
            <div className="flex gap-2">
              <button onClick={handleCreate} className="rounded-xl bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">
                Create
              </button>
              <button onClick={() => setShowNewForm(false)} className="rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!hydrated && (
          <div className="flex-1 flex items-center justify-center px-6 py-12 text-center text-xs text-[var(--color-text-tertiary)]">Loading artifacts…</div>
        )}

        {/* Type summary tiles — only when no filter and not searching */}
        {hydrated && filter === 'all' && !search && artifacts.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="text-3xl mb-3">📄</div>
            <div className="text-sm font-semibold text-[var(--color-text-secondary)]">No artifacts yet</div>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)] max-w-xs leading-5">
              Artifacts are generated from chat, code, benchmarks, or governance sessions. Click <strong>+ New</strong> to create one manually.
            </p>
          </div>
        )}

        {filter === 'all' && !search && artifacts.length > 0 && (
          <div className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-5 py-3">
            <div className="grid grid-cols-3 gap-2">
              {typeCounts.filter((t) => t.count > 0).map(({ type, label, count }) => (
                <button
                  key={type}
                  onClick={() => setFilter(type as ArtifactType)}
                  className="flex items-center gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-left transition hover:border-[#bfdbfe] hover:bg-[#eff6ff]"
                >
                  <span className="text-base">{artifactTypeIcon(type as ArtifactType)}</span>
                  <div>
                    <div className="text-xs font-semibold text-[var(--color-text-primary)]">{count}</div>
                    <div className="text-[10px] text-[var(--color-text-secondary)]">{label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Artifact list */}
        {filtered.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[#f1f5f9]">
            {filtered.map((a) => (
              <ArtifactRow
                key={a.id}
                artifact={a}
                selected={a.id === selectedId}
                onSelect={() => setSelectedId(a.id === selectedId ? null : a.id)}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && artifacts.length > 0 && (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-tertiary)]">
            No artifacts match this filter.
          </div>
        )}
      </div>

      {/* Right canvas: artifact pane */}
      {selectedArtifact && (
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          <ArtifactPane
            artifact={selectedArtifact}
            onClose={() => setSelectedId(null)}
            onUpdate={updateArtifact}
            onDelete={deleteArtifact}
          />
        </div>
      )}
    </div>
  )
}

function ArtifactRow({ artifact, selected, onSelect }: { artifact: Artifact; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-start gap-3 px-5 py-3 text-left transition ${
        selected ? 'bg-[#eff6ff]' : 'hover:bg-[var(--color-background-secondary)]'
      }`}
    >
      <span className="mt-0.5 text-lg shrink-0">{artifactTypeIcon(artifact.type)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{artifact.title}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
            artifact.status === 'final'    ? 'bg-[#dcfce7] text-[#16a34a]' :
            artifact.status === 'archived' ? 'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]' :
            'bg-[#fef9c3] text-[#92400e]'
          }`}>{artifact.status}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
          <span>{artifactTypeLabel(artifact.type)}</span>
          <span>·</span>
          <span>{timeAgo(artifact.updatedAt)}</span>
          {artifact.tags.length > 0 && <><span>·</span><span>{artifact.tags.map((t) => `#${t}`).join(' ')}</span></>}
        </div>
        <div className="mt-1 truncate text-[11px] text-[var(--color-text-secondary)]">
          {artifact.content.slice(0, 80)}
        </div>
      </div>
    </button>
  )
}

'use client'

import { useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { useMemory } from '@/lib/memory/useMemory'
import { amUrl } from '@/lib/tauri/bridge'
import type { MemoryScope } from '@/lib/settings/types'

const scopes: { value: MemoryScope; label: string; desc: string }[] = [
  { value: 'disabled', label: 'Disabled', desc: 'No memory read or injected.' },
  { value: 'session', label: 'Session', desc: 'Memory injected but not persisted across restarts.' },
  { value: 'project', label: 'Project', desc: 'Memory persists within the active workspace.' },
  { value: 'global', label: 'Global', desc: 'Memory persists across all workspaces.' },
]

export function MemoryPanel() {
  const { settings, update } = useSettings()
  const { entries, embeddedCount, remember, forget, edit, hydrated, embedAll } = useMemory()
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [indexResult, setIndexResult] = useState<{ embedded: number; failed: number } | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importSource, setImportSource] = useState('chatgpt')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ count: number; imported: number } | null>(null)

  function handleAdd() {
    const text = newText.trim()
    if (!text) return
    remember(text, { source: 'user' })
    setNewText('')
  }

  async function handleImport() {
    const text = importText.trim()
    if (!text) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch(amUrl('/api/memory/import'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, source: importSource }),
      })
      if (res.ok) {
        const data = await res.json() as { count: number; imported: number }
        setImportResult(data)
        setImportText('')
        setShowImport(false)
      }
    } catch { /* network error */ } finally {
      setImporting(false)
    }
  }

  function startEdit(id: string, text: string) {
    setEditingId(id)
    setEditText(text)
  }

  function commitEdit() {
    if (editingId) edit(editingId, editText.trim())
    setEditingId(null)
    setEditText('')
  }

  return (
    <div className="space-y-6">
      {/* Scope selector */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Memory scope</div>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Controls when memories are injected into conversations.</p>
        <div className="mt-3 space-y-2">
          {scopes.map(({ value, label, desc }) => (
            <button key={value} onClick={() => update({ memoryScope: value })}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                settings.memoryScope === value
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:bg-[var(--color-background-secondary)]'
              }`}>
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                settings.memoryScope === value ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[#cbd5e1]'
              }`}>
                {settings.memoryScope === value && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-background-primary)]" />}
              </span>
              <div>
                <div className={`text-sm font-semibold ${settings.memoryScope === value ? 'text-[var(--accent)]' : 'text-[var(--color-text-primary)]'}`}>{label}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Memory entries */}
      <div>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">
            Memories
            {hydrated && entries.length > 0 && (
              <span className="ml-2 rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 text-[11px] font-normal text-[var(--color-text-secondary)]">
                {entries.length}
              </span>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Facts injected as context per turn — semantically ranked when indexed.</p>

        {/* Add new */}
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="e.g. Prefers concise answers. Works in TypeScript."
            className="flex-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent)] focus:bg-white placeholder:text-[var(--color-text-tertiary)]"
            disabled={settings.memoryScope === 'disabled'}
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim() || settings.memoryScope === 'disabled'}
            className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {/* Entry list */}
        <div className="mt-3 space-y-1.5">
          {!hydrated && (
            <div className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading…</div>
          )}
          {hydrated && entries.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] py-6 text-center text-xs text-[var(--color-text-tertiary)]">
              No memories yet. Add one above or let the AI remember things for you.
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="group flex items-start gap-2 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-3 py-2 transition hover:border-[var(--color-border-secondary)]">
              <span className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                {entry.source === 'auto' ? '🤖' : '👤'}
              </span>
              {/* Embedding status dot */}
              <div
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${entry.embedding ? 'bg-[var(--accent)]' : 'bg-[#cbd5e1]'}`}
                title={entry.embedding ? 'Semantically indexed' : 'Not indexed'}
              />
              {editingId === entry.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditingId(null) } }}
                  className="flex-1 border-0 bg-transparent text-sm text-[var(--color-text-primary)] outline-none"
                />
              ) : (
                <span
                  className="flex-1 cursor-text text-sm text-[var(--color-text-primary)]"
                  onClick={() => startEdit(entry.id, entry.text)}
                >
                  {entry.text}
                </span>
              )}
              <button
                onClick={() => forget(entry.id)}
                className="shrink-0 rounded p-0.5 text-[var(--color-text-tertiary)] opacity-0 transition hover:text-[#dc2626] group-hover:opacity-100"
                title="Forget"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Semantic index */}
      {hydrated && entries.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Semantic index</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {embeddedCount}/{entries.length} memories indexed
                {embeddedCount === entries.length && entries.length > 0 ? ' · all indexed' : embeddedCount > 0 ? ' · partial index' : ' · keyword-only'}
              </p>
            </div>
            {/* Progress bar */}
            <div className="w-20 h-1.5 rounded-full bg-[var(--color-background-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: entries.length > 0 ? `${(embeddedCount / entries.length) * 100}%` : '0%' }}
              />
            </div>
          </div>
          {embeddedCount < entries.length && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Build a vector index for semantic retrieval — conversations will receive the most relevant memories instead of all memories.
                {settings.openaiApiKey
                  ? ' Uses OpenAI embeddings.'
                  : ' Uses a local Ollama embedding model (no key needed).'}
              </p>
              {indexResult && (
                <p className="text-xs text-[#059669]">
                  Indexed {indexResult.embedded} memories{indexResult.failed > 0 ? `, ${indexResult.failed} failed` : ''}.
                </p>
              )}
              <button
                onClick={async () => {
                  setIndexing(true)
                  setIndexResult(null)
                  try {
                    const result = await embedAll(settings.openaiApiKey || undefined)
                    setIndexResult(result)
                  } finally {
                    setIndexing(false)
                  }
                }}
                disabled={indexing}
                className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-40"
              >
                {indexing ? 'Indexing…' : 'Build semantic index'}
              </button>
            </div>
          )}
          {embeddedCount === entries.length && entries.length > 0 && (
            <p className="text-xs text-[#059669]">Semantic retrieval active — memories are ranked by relevance each turn.</p>
          )}
        </div>
      )}

      {/* Retention */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
          Retention — {settings.memoryRetentionDays} days
        </label>
        <input type="range" min={1} max={365}
          value={settings.memoryRetentionDays}
          onChange={(e) => update({ memoryRetentionDays: Number(e.target.value) })}
          className="mt-3 w-full accent-[var(--accent)]"
          disabled={settings.memoryScope === 'disabled'}
        />
        <div className="mt-1 flex justify-between text-xs text-[var(--color-text-tertiary)]">
          <span>1 day</span><span>1 year</span>
        </div>
      </div>

      {/* Import from another AI */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Import from another AI</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Paste your exported memories from ChatGPT, Gemini, or Claude.</p>
          </div>
          <button
            onClick={() => { setShowImport(!showImport); setImportResult(null) }}
            className="rounded-xl border border-[var(--color-border-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] transition hover:bg-[var(--color-background-secondary)]"
          >
            {showImport ? 'Cancel' : 'Import'}
          </button>
        </div>
        {importResult && !showImport && (
          <p className="mt-2 text-xs text-[#059669]">Imported {importResult.imported} of {importResult.count} memories.</p>
        )}
        {showImport && (
          <div className="mt-3 space-y-2">
            <select
              value={importSource}
              onChange={(e) => setImportSource(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent)]"
            >
              <option value="chatgpt">ChatGPT</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
              <option value="other">Other</option>
            </select>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder="Paste your exported memories here (one per line, or a bulleted list)…"
              className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent)] resize-none placeholder:text-[var(--color-text-tertiary)]"
            />
            <button
              onClick={handleImport}
              disabled={!importText.trim() || importing}
              className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-40"
            >
              {importing ? 'Importing…' : 'Import memories'}
            </button>
          </div>
        )}
      </div>

      {/* Clear all */}
      <div>
        {!confirmClear ? (
          <button onClick={() => setConfirmClear(true)}
            className="rounded-xl border border-[#fecaca] bg-[var(--color-background-primary)] px-4 py-2 text-sm font-semibold text-[#dc2626] transition hover:bg-[#fef2f2]">
            Clear all memory
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#dc2626]">Clear all {entries.length} memories?</span>
            <button onClick={() => {
              entries.forEach((e) => forget(e.id))
              setConfirmClear(false)
            }} className="rounded-xl bg-[#dc2626] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#b91c1c]">
              Confirm
            </button>
            <button onClick={() => setConfirmClear(false)} className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

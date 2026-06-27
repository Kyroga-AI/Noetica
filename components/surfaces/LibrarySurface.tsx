'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * LibrarySurface — "what's been captured into the graph" (like ChatGPT's library, but for the knowledge graph).
 * Reads /api/library: collections → documents → chunk/entity counts, grouped by scope. User uploads
 * (collections + inbox) come first and can be soft-deleted (cleanup for pollution); system scopes
 * (memory/knowledge/self) are shown read-only/protected. This is the observability layer that makes "what
 * landed, where" visible — the thing whose absence let the doc-pollution incident go unnoticed.
 */
type LibraryDoc = { docId: string; filename: string; name: string; chunks: number; entities: number }
type LibraryGroup = {
  scope: string; kind: 'collection' | 'system' | 'inbox'; id?: string; name: string
  source?: string; createdAt?: string; docCount: number; chunkCount: number; entityCount: number; docs: LibraryDoc[]
}
type Library = { groups: LibraryGroup[]; totals: { collections: number; documents: number; chunks: number; entities: number } }

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

const KIND_BADGE: Record<LibraryGroup['kind'], { label: string; cls: string }> = {
  collection: { label: 'collection', cls: 'bg-[#eff6ff] text-[#1d4ed8]' },
  inbox: { label: 'inbox', cls: 'bg-[#fef3c7] text-[#92400e]' },
  system: { label: 'system · protected', cls: 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]' },
}

export function LibrarySurface() {
  const [lib, setLib] = useState<Library | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    setErr('')
    void fetch(amUrl('/api/library'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Library) => setLib(d))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed to load — is the backend running?'))
  }, [])
  useEffect(load, [load])

  async function remove(g: LibraryGroup) {
    if (!g.id) return
    if (!window.confirm(`Remove "${g.name}" — ${g.docCount} document${g.docCount === 1 ? '' : 's'}? They drop out of retrieval and the Library (provenance is preserved).`)) return
    setBusy(g.scope)
    try {
      const r = await fetch(amUrl(`/api/library?collection=${encodeURIComponent(g.id)}`), { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'delete failed') }
    finally { setBusy('') }
  }

  const t = lib?.totals
  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-1 flex items-center gap-3">
        <div className="text-lg font-semibold text-[var(--color-text-primary)]">Library</div>
        <button onClick={load} className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">refresh</button>
      </div>
      <p className="mb-5 max-w-2xl text-xs text-[var(--color-text-secondary)]">Everything captured into the knowledge graph — your collections, the documents in each, and how many chunks and entities they contributed. Clean up what you don&apos;t need; system scopes are protected.</p>

      {/* Totals */}
      {t && (
        <div className="mb-5 grid grid-cols-4 gap-3">
          {[['Collections', t.collections], ['Documents', t.documents], ['Chunks', t.chunks], ['Entities', t.entities]].map(([k, v]) => (
            <div key={k as string} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
              <div className="text-xl font-semibold text-[var(--color-text-primary)]">{(v as number).toLocaleString()}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">{k}</div>
            </div>
          ))}
        </div>
      )}

      {err && <div className="mb-4 rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-[11px] text-[#b91c1c]">{err}</div>}
      {!lib && !err && <div className="text-[11px] text-[var(--color-text-tertiary)]">Loading…</div>}
      {lib && lib.groups.length === 0 && <div className="text-[11px] text-[var(--color-text-tertiary)]">Nothing captured yet — drop documents into a chat to ingest them.</div>}

      {/* Groups */}
      <div className="space-y-2">
        {lib?.groups.map((g) => {
          const isOpen = open[g.scope]
          const badge = KIND_BADGE[g.kind]
          return (
            <div key={g.scope} className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
              <div className="flex items-center gap-2 px-4 py-3">
                <button onClick={() => setOpen((o) => ({ ...o, [g.scope]: !o[g.scope] }))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={`shrink-0 text-[var(--color-text-tertiary)] transition ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                  <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{g.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-px text-[9px] font-medium ${badge.cls}`}>{badge.label}</span>
                  {g.source && <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">· {g.source}</span>}
                </button>
                <div className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{g.docCount} docs · {g.chunkCount} chunks · {g.entityCount} entities</div>
                {g.kind !== 'system' && g.id && (
                  <button onClick={() => void remove(g)} disabled={busy === g.scope} className="shrink-0 rounded-lg border border-[#fecaca] px-2 py-0.5 text-[10px] text-[#dc2626] transition hover:bg-[#fef2f2] disabled:opacity-50">{busy === g.scope ? '…' : 'remove'}</button>
                )}
              </div>
              {isOpen && g.docs.length > 0 && (
                <div className="border-t border-[var(--color-border-secondary)] px-4 py-2">
                  {g.docs.map((d) => (
                    <div key={d.docId} className="flex items-center gap-2 py-1 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">{d.name}</span>
                      <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{d.chunks} chunks{d.entities ? ` · ${d.entities} entities` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {t && t.entities > 0 && (
        <p className="mt-4 text-[10px] text-[var(--color-text-tertiary)]">Entity counts are graph-wide; per-document entity attribution lands once Document→entity linkage is wired (tiered-memory step 3).</p>
      )}
    </div>
  )
}

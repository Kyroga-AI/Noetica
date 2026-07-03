'use client'

import { useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

/**
 * RagInspectSurface — the retrieval-debug screen MS Foundry / Vertex do weakly and nobody does well.
 * "Where did this come from, and why these chunks?" Shows semantic + lexical retrieval side-by-side with
 * per-chunk scores and sources, so the user can see + tune what feeds generation. Backed by /api/cap/rag-inspect.
 */
interface Chunk { text: string; source: string; score: number }

export function RagInspectSurface() {
  const [query, setQuery] = useState('')
  const [semantic, setSemantic] = useState<Chunk[]>([])
  const [lexical, setLexical] = useState<Chunk[]>([])
  const [loading, setLoading] = useState(false)
  const [ran, setRan] = useState(false)
  const [err, setErr] = useState('')

  async function run() {
    if (!query.trim()) return
    setLoading(true); setErr('')
    try {
      const res = await fetch(amUrl('/api/cap/rag-inspect'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as { semantic?: Chunk[]; lexical?: Chunk[] }
      setSemantic(d.semantic ?? []); setLexical(d.lexical ?? []); setRan(true)
    } catch (e) { setSemantic([]); setLexical([]); setRan(false); setErr(e instanceof Error ? `Inspect failed: ${e.message} — is the backend running?` : 'Inspect failed') } finally { setLoading(false) }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-primary)]">
      <header className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">RAG Inspector</h1>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">retrieval debug · what feeds the answer + why</span>
      </header>
      <div className="flex gap-2 border-b border-[var(--color-border-secondary)] px-5 py-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
          placeholder="Query to inspect retrieval for…"
          className="flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs text-[var(--color-text-primary)]" />
        <button onClick={() => void run()} disabled={loading} className="rounded-md bg-[var(--color-accent,#0891b2)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50">{loading ? 'Retrieving…' : 'Inspect'}</button>
      </div>
      {err && <div className="border-b border-[#fca5a5] bg-[#fef2f2] px-5 py-2 text-[11px] text-[#b91c1c]">{err}</div>}
      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-5">
        <ChunkColumn title="Semantic (dense / nomic-embed)" chunks={semantic} ran={ran} accent="#0891b2" />
        <ChunkColumn title="Lexical (BM25)" chunks={lexical} ran={ran} accent="#a855f7" />
      </div>
    </div>
  )
}

function ChunkColumn({ title, chunks, ran, accent }: { title: string; chunks: Chunk[]; ran: boolean; accent: string }) {
  const max = Math.max(1, ...chunks.map((c) => c.score))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">{title}</span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">{chunks.length} chunks</span>
      </div>
      {ran && chunks.length === 0 && <p className="text-[11px] text-[var(--color-text-tertiary)]">No chunks retrieved.</p>}
      {chunks.map((c, i) => (
        <div key={i} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="truncate text-[10px] font-medium text-[var(--color-text-secondary)]">{c.source || 'unknown'}</span>
            <div className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border-tertiary)]">
              <div className="h-full rounded-full" style={{ width: `${(c.score / max) * 100}%`, background: accent }} />
            </div>
            <span className="text-[9px] tabular-nums text-[var(--color-text-tertiary)]">{c.score.toFixed(3)}</span>
          </div>
          <p className="line-clamp-4 text-[11px] leading-snug text-[var(--color-text-tertiary)]">{c.text}</p>
        </div>
      ))}
    </div>
  )
}

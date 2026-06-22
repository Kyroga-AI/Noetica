/**
 * rag-rerank — hybrid retrieval reranking. The field's #1 unmet RAG gap is that local apps run a
 * single-stage cosine top-k; Noetica has THREE signals (semantic embedding, lexical keyword, and
 * exact term overlap) and fuses them. Reciprocal Rank Fusion (RRF) combines the semantic and
 * lexical rankings — a chunk that BOTH rankers like floats to the top — plus a query-term-overlap
 * boost so a literal match (e.g. "hospital") isn't buried by a semantically-close miss. Returns
 * ranked chunks with PER-CHUNK citations (filename#chunkIndex), the other thing no major local app
 * ships. Pure + deterministic; the retrieval path feeds it semantic + lexical hits.
 */

export interface RankableHit {
  docId: string
  filename: string
  text: string
  score: number
  idx?: number // chunk index within the document (per-chunk citation anchor)
}

export interface RankedChunk {
  docId: string
  filename: string
  text: string
  chunkIndex: number | null // null when the ranker that surfaced it didn't carry a position
  fusedScore: number
  signals: { semanticRank: number | null; lexicalRank: number | null; termOverlap: number }
  citation: string // "report.pdf#3" (with index) or "report.pdf" (index unknown)
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'what',
  'which', 'how', 'why', 'who', 'does', 'has', 'have', 'about', 'into', 'over'])

/** Content words in a query/text: lowercased, ≥3 chars, de-stopped. */
function terms(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
}

/** Fraction of distinct query terms that appear in the chunk text (0..1). */
function termOverlap(queryTerms: Set<string>, text: string): number {
  if (queryTerms.size === 0) return 0
  const t = new Set(terms(text))
  let hit = 0
  for (const q of queryTerms) if (t.has(q)) hit++
  return hit / queryTerms.size
}

// Dedup key is text-based, not idx-based: the same chunk has identical text in both rankers, but
// only the lexical ranker carries idx — so idx-keying would fail to merge a chunk present in both.
const keyOf = (h: RankableHit): string => `${h.docId}::${h.text.slice(0, 64).toLowerCase()}`
const citeOf = (filename: string, idx: number | null): string => (idx == null ? filename : `${filename}#${idx}`)

/**
 * Fuse semantic + lexical rankings via RRF and rerank. k is the RRF damping constant (60 is the
 * canonical default — larger flattens rank influence). termBoost scales the exact-overlap signal.
 */
export function fuseRerank(
  semantic: RankableHit[],
  lexical: RankableHit[],
  query: string,
  opts?: { k?: number; limit?: number; termBoost?: number },
): RankedChunk[] {
  const k = opts?.k ?? 60
  const limit = opts?.limit ?? 8
  const termBoost = opts?.termBoost ?? 0.15
  const queryTerms = new Set(terms(query))

  const acc = new Map<string, RankedChunk>()
  const fold = (hits: RankableHit[], which: 'semanticRank' | 'lexicalRank') => {
    hits.forEach((h, i) => {
      const rank = i + 1
      const key = keyOf(h)
      let row = acc.get(key)
      if (!row) {
        row = {
          docId: h.docId,
          filename: h.filename,
          text: h.text,
          chunkIndex: h.idx ?? null,
          fusedScore: 0,
          signals: { semanticRank: null, lexicalRank: null, termOverlap: termOverlap(queryTerms, h.text) },
          citation: citeOf(h.filename, h.idx ?? null),
        }
        acc.set(key, row)
      } else if (row.chunkIndex == null && h.idx != null) {
        // a later ranker (lexical) supplied the position the first (semantic) lacked
        row.chunkIndex = h.idx
        row.citation = citeOf(row.filename, h.idx)
      }
      row.signals[which] = rank
      row.fusedScore += 1 / (k + rank)
    })
  }
  fold(semantic, 'semanticRank')
  fold(lexical, 'lexicalRank')

  // Add the exact-term-overlap boost — a literal keyword match shouldn't be buried by a
  // semantically-near miss (the "company on Hospital Way must surface for 'hospital'" case).
  for (const row of acc.values()) row.fusedScore += termBoost * row.signals.termOverlap

  return [...acc.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || a.citation.localeCompare(b.citation))
    .slice(0, limit)
}

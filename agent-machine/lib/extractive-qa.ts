/**
 * extractive-qa — grounded answering by EXTRACTION, not generation. For doc-grounded
 * intents we rank the actual sentences of the retrieved passages against the question
 * and return them verbatim with citations. The payoff on a weak/slow local box:
 *
 *   • cannot hallucinate — every word is from the source (the dry-run had a 3B invent
 *     "Hurricane Helene 2008, General John A. Baxter of Kentucky"; extraction can't),
 *   • ~instant — no token generation, just retrieve + rank + format,
 *   • cited by construction — each sentence carries its source marker.
 *
 * Ranking is lexical (query-term overlap) blended with the chunk's retrieval score —
 * the chunks are already semantically retrieved, so sentence-level lexical ranking
 * within them surfaces the on-point lines without any extra model call.
 */
import type { ChunkHit } from './doc-store.js'

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'with', 'as', 'at', 'by', 'it', 'this', 'that', 'what', 'which', 'how', 'does', 'do', 'did', 'about', 'from', 'report', 'say', 'says', 'tell', 'me'])

function terms(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOP.has(t))
}

/** Split chunk text into sentences, keeping ones with real content. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16 && s.length <= 600 && /[a-z]/i.test(s))
}

export interface ExtractiveAnswer {
  answer: string
  used: { text: string; source: number; score: number }[]
  sources: { n: number; filename: string }[]
  grounded: boolean
}

/**
 * Build a cited, extractive answer from retrieved chunks. Returns null when nothing
 * scores above the floor (caller then says so / falls back) — never fabricates.
 */
export function extractiveAnswer(query: string, hits: ChunkHit[], opts: { maxSentences?: number } = {}): ExtractiveAnswer | null {
  const maxSentences = opts.maxSentences ?? 5
  const qTerms = new Set(terms(query))
  if (qTerms.size === 0 || hits.length === 0) return null

  // Source numbering follows the retrieved-chunk order (matches the [n] the model
  // would have cited, so the UI's source chips line up).
  const sources = hits.map((h, i) => ({ n: i + 1, filename: h.filename }))

  type Scored = { text: string; source: number; score: number }
  const scored: Scored[] = []
  hits.forEach((h, i) => {
    for (const sent of sentences(h.text)) {
      const sTerms = terms(sent)
      if (sTerms.length === 0) continue
      let overlap = 0
      for (const t of sTerms) if (qTerms.has(t)) overlap++
      if (overlap === 0) continue
      // query coverage + a nudge from the chunk's semantic retrieval score
      const score = overlap / qTerms.size + 0.25 * h.score
      scored.push({ text: sent, source: i + 1, score: Number(score.toFixed(3)) })
    }
  })
  if (scored.length === 0) return null

  // Rank, dedupe near-identical lines, keep the top few.
  scored.sort((a, b) => b.score - a.score)
  const used: Scored[] = []
  const seen = new Set<string>()
  for (const s of scored) {
    const key = s.text.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    used.push(s)
    if (used.length >= maxSentences) break
  }

  const body = used.map((s) => `- ${s.text} [${s.source}]`).join('\n')
  const srcList = sources
    .filter((s) => used.some((u) => u.source === s.n))
    .map((s) => `[${s.n}] ${s.filename}`)
    .join('  ·  ')
  const answer = `From the document:\n\n${body}\n\nSources: ${srcList}`
  return { answer, used, sources, grounded: true }
}

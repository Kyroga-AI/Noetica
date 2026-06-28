/**
 * cite-match.ts — deterministic post-hoc citation. The reliability backstop for inline `[n]` citations.
 *
 * The pieces already exist: the doc-grounded path numbers its sources `[1]..[k]` and PROMPTS the model to end
 * each grounded sentence with a marker, and the chat UI (MessageBubble) renders `[n]` as clickable superscripts
 * linked to the source list. The weak link is a local 7B that forgets to emit the marker — so a grounded answer
 * silently loses its citations and the moat's evidence goes invisible.
 *
 * This module guarantees the markers regardless of model compliance: given the answer text and the SAME numbered
 * sources (with their chunk text), it appends `[n]` to each factual sentence that a source supports, by
 * content-word overlap. It is DETERMINISTIC (no model call) and IDEMPOTENT — a sentence that already carries a
 * `[n]` marker is left untouched, so it composes with a model that did cite correctly.
 *
 * Pure + offline. Wire it as a post-stream finalizer (see citeMatch docstring) — it never fabricates support:
 * a sentence with no matching source gets no marker (honest under-citation beats a wrong citation).
 */

const STOP = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one', 'our', 'out',
  'has', 'had', 'his', 'how', 'its', 'who', 'this', 'that', 'with', 'from', 'they', 'will', 'would', 'there',
  'their', 'what', 'which', 'when', 'were', 'been', 'have', 'than', 'then', 'them', 'these', 'those', 'into',
  'such', 'also', 'only', 'each', 'some', 'more', 'most', 'other', 'about', 'your', 'because',
])

/** Lowercased content tokens (len ≥ 4, stopwords removed) — the comparison vocabulary. */
export function contentTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t)))
}

export interface CiteSource {
  n: number      // the source's display number (the [n] the UI list uses)
  text: string   // the source chunk text to match the answer against
}

const overlapFraction = (sent: Set<string>, src: Set<string>): number => {
  if (sent.size === 0) return 0
  let hit = 0
  for (const t of sent) if (src.has(t)) hit++
  return hit / sent.size
}

/**
 * Best-supporting source for a sentence: the numbered source whose text covers the largest fraction of the
 * sentence's content tokens, provided that fraction clears `floor`. Returns null when nothing supports it.
 */
export function bestSource(sentence: string, sources: CiteSource[], floor = 0.5): number | null {
  const sent = contentTokens(sentence)
  if (sent.size < 2) return null   // too thin to attribute confidently
  let bestN: number | null = null
  let bestFrac = floor
  for (const s of sources) {
    const frac = overlapFraction(sent, contentTokens(s.text))
    if (frac >= bestFrac) { bestFrac = frac; bestN = s.n }
  }
  return bestN
}

const ALREADY_CITED = /\[\d+\]\s*[.!?)\]]*\s*$/   // sentence already ends with a [n] marker
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/

/**
 * Append `[n]` to each factual sentence that a source supports but that isn't already cited. Idempotent and
 * non-fabricating. Intended as a POST-STREAM finalizer: after the answer is fully generated, call
 *   citeMatch(fullAnswer, hits.map((h, i) => ({ n: i + 1, text: h.safeText })))
 * and emit the cited string (e.g. a final `cited` SSE event the UI swaps in, or the stored message content).
 * The marker is inserted BEFORE the sentence's terminal punctuation: "Plants rely on tap water." →
 * "Plants rely on tap water [2]."
 */
export function citeMatch(answer: string, sources: CiteSource[], opts: { floor?: number } = {}): string {
  if (!answer || sources.length === 0) return answer
  const floor = opts.floor ?? 0.5
  return answer.split('\n').map((line) => {
    // Don't touch fenced code, headings, or blank lines.
    if (!line.trim() || line.trimStart().startsWith('#') || line.trimStart().startsWith('```') || line.trimStart().startsWith('|')) return line
    const parts = line.split(SENTENCE_SPLIT)
    return parts.map((sent) => {
      if (!sent.trim() || ALREADY_CITED.test(sent)) return sent
      const n = bestSource(sent, sources, floor)
      if (n == null) return sent
      // insert before trailing terminal punctuation + closing quotes/brackets, else append.
      const m = sent.match(/^([\s\S]*?)([.!?]+["')\]]*)(\s*)$/)
      return m ? `${m[1]} [${n}]${m[2]}${m[3]}` : `${sent.replace(/\s*$/, '')} [${n}]`
    }).join(' ')
  }).join('\n')
}

/** Citation coverage of an answer: fraction of substantive sentences carrying a [n] marker (telemetry / worth gate). */
export function citationCoverage(answer: string): { sentences: number; cited: number; coverage: number } {
  const sents = answer.split('\n').flatMap((l) => (l.trim() && !l.trimStart().startsWith('#') ? l.split(SENTENCE_SPLIT) : []))
    .filter((s) => contentTokens(s).size >= 2)
  const cited = sents.filter((s) => /\[\d+\]/.test(s)).length
  return { sentences: sents.length, cited, coverage: sents.length ? Number((cited / sents.length).toFixed(2)) : 1 }
}

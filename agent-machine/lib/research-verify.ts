/**
 * research-verify — a VERIFIER for research answers, so the compounding loop extends past coding.
 *
 * Coding has a hard verifier (exit 0). Research needs one too, or storing answers just compounds
 * hallucination. This is a deterministic GROUNDING check: every claim (sentence) in the answer must
 * have its content tokens substantially present in the retrieved sources. A claim whose tokens don't
 * appear in any source is unsupported (the model made it up). Score = fraction of claims grounded.
 *
 * It's lexical, not full entailment — but it reliably catches the failure that matters: assertions
 * the sources never made. That's the signal that makes a stored research answer trustworthy to reuse.
 */

const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'were', 'this', 'that', 'with', 'from', 'have', 'has', 'had', 'not', 'but', 'you', 'your', 'they', 'their', 'them', 'its', 'his', 'her', 'our', 'can', 'will', 'would', 'could', 'should', 'into', 'than', 'then', 'when', 'what', 'which', 'who', 'how', 'why', 'all', 'any', 'some', 'one', 'two', 'also', 'more', 'most', 'such', 'about', 'over', 'under', 'these', 'those'])

function contentTokens(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 3 && !STOP.has(t)))]
}

export interface GroundingResult { grounded: boolean; score: number; supported: number; total: number; unsupported: string[] }

/**
 * @param answer  the model's answer text
 * @param sources retrieved source texts the answer must be grounded in
 * @param claimCover fraction of a claim's content tokens that must appear in the sources (default .5)
 * @param passAt fraction of claims that must be grounded for the answer to pass (default .7)
 */
export function verifyGrounding(answer: string, sources: { text: string }[], claimCover = 0.5, passAt = 0.7): GroundingResult {
  const srcTokens = new Set<string>()
  for (const s of sources) for (const t of contentTokens(s.text)) srcTokens.add(t)
  const claims = answer.split(/(?<=[.!?])\s+/).map((c) => c.trim()).filter((c) => c.length > 15)
  if (!claims.length) return { grounded: false, score: 0, supported: 0, total: 0, unsupported: [] }
  const unsupported: string[] = []
  let supported = 0
  for (const claim of claims) {
    const ct = contentTokens(claim)
    if (!ct.length) { supported++; continue }   // no content tokens (filler) — not a factual claim
    const covered = ct.filter((t) => srcTokens.has(t)).length / ct.length
    if (covered >= claimCover) supported++
    else unsupported.push(claim.slice(0, 140))
  }
  const score = supported / claims.length
  return { grounded: score >= passAt, score, supported, total: claims.length, unsupported }
}

/**
 * graph-contradict.ts — verified contradiction detection across the knowledge graph.
 *
 * Every other RAG/graph system treats extracted claims as independently true. But a real corpus
 * contradicts itself — two sources say different things, an old fact is superseded, an extraction errs.
 * We already verify each claim against its evidence; this goes further and checks claims against EACH
 * OTHER. Candidate conflicts (same subject + type, overlapping topic, divergent assertion) are
 * adjudicated by the model: contradictory or not, and if so, which is better supported. The result is
 * "contested" knowledge surfaced instead of silently averaged — the epistemic layer no incumbent ships.
 */

import { generateOllamaText } from './ollama.js'
import type { EntityCovariates } from './graph-covariates.js'

export interface Contradiction {
  subject: string
  type: string
  claimA: string
  claimB: string
  contradictory: boolean
  kind: 'contested' | 'superseded'   // contested = live conflict; superseded = newer fact replaces older
  current?: string                   // when superseded, the claim that's currently valid (the newer one)
  resolution: string                 // which claim is better supported + why, or why both can hold
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'does', 'not', 'are', 'has', 'its', 'a', 'an', 'of', 'in', 'to', 'is'])
function toks(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)))
}
function overlap(a: Set<string>, b: Set<string>): number { let n = 0; for (const t of a) if (b.has(t)) n++; return n }

function safeJson(s: string): { contradictory?: boolean; resolution?: string } | null {
  const m = s.match(/\{[\s\S]*\}/); if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** Find + adjudicate contradictions among verified covariates. Bounded LLM calls (capped candidates). */
export async function findContradictions(covariates: EntityCovariates[], opts: { model: string; maxCandidates?: number }): Promise<Contradiction[]> {
  // Flatten claims; keep only grounded ones (an ungrounded claim contradicting anything is just noise).
  const claims = covariates.flatMap((e) => e.covariates.filter((c) => c.grounded).map((c) => ({ subject: e.entity, type: c.type, claim: c.claim, validFrom: c.validFrom, tok: toks(c.claim) })))

  // Candidate pairs: same claim TYPE (e.g. two "ownership" claims), topically overlapping, but different
  // text — the shape of a real disagreement. Cross-entity too (different subjects asserting the same role).
  const candidates: Array<[typeof claims[number], typeof claims[number]]> = []
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]!, b = claims[j]!
      if (a.claim === b.claim) continue
      if (a.type !== b.type) continue
      if (overlap(a.tok, b.tok) < 2) continue
      candidates.push([a, b])
    }
  }
  // Rank by topical overlap (most-overlapping = most likely a real conflict) and cap LLM work.
  candidates.sort((x, y) => overlap(y[0].tok, y[1].tok) - overlap(x[0].tok, x[1].tok))
  const capped = candidates.slice(0, opts.maxCandidates ?? 14)

  const out: Contradiction[] = []
  for (const [a, b] of capped) {
    const prompt = `Two claims extracted from a knowledge graph:\nA: "${a.claim}"\nB: "${b.claim}"\n\nDo these CONTRADICT each other (they cannot both be true as stated)? If yes, say which is more likely correct and why. STRICT JSON only:\n{"contradictory": true|false, "resolution": "<one sentence: which holds + why, or why both can be true>"}`
    try {
      const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, numCtx: 4096 })
      const j = safeJson(content)
      if (j?.contradictory) {
        // Bi-temporal: if the two claims entered the graph at different times, the conflict is most
        // likely a SUPERSESSION (newer fact replaces older), not a live contestation.
        const aF = a.validFrom, bF = b.validFrom
        const superseded = !!(aF && bF && Math.abs(aF - bF) > 1000)
        out.push({
          subject: a.subject, type: a.type, claimA: a.claim, claimB: b.claim, contradictory: true,
          kind: superseded ? 'superseded' : 'contested',
          ...(superseded ? { current: (aF! > bF! ? a.claim : b.claim) } : {}),
          resolution: (j.resolution || '').slice(0, 280),
        })
      }
    } catch { /* skip this pair */ }
  }
  return out
}

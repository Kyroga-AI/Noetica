/**
 * opencog-values.ts — the OpenCog capabilities HellGraph genuinely LACKS (verified: no TruthValue/
 * AttentionValue/PLN/ECAN in the package), built as a Noetica layer over node/edge properties we control.
 *   • TruthValue {strength, confidence} + PLN formulas (deduction, revision) — uncertain inference.
 *   • AttentionValue {sti, lti} + ECAN (stimulate, spread, decay, normalize) — salience / working memory.
 *   • Truth-weighted, attention-personalized PageRank — ranking that is epistemically + attentionally aware,
 *     which DE-NOISES the dev/test-exhaust problem (low-confidence/test edges demoted; salient nodes promoted).
 * Pairs with the grounding verifier (which already trusts confidence) and our personalized PageRank.
 */
const clamp = (x: number) => Math.min(1, Math.max(0, x))

// ── TruthValue (PLN SimpleTruthValue) ──
export interface TruthValue { strength: number; confidence: number }
export const stv = (strength: number, confidence: number): TruthValue => ({ strength: clamp(strength), confidence: clamp(confidence) })

/** PLN deduction: A→B ∧ B→C ⇒ A→C (simplified strength product, confidence product). */
export function deduction(ab: TruthValue, bc: TruthValue): TruthValue {
  return stv(ab.strength * bc.strength, ab.confidence * bc.confidence)
}
/** PLN revision: merge two estimates of the SAME statement, confidence-weighted (Bayesian-ish). */
export function revision(a: TruthValue, b: TruthValue): TruthValue {
  const c = a.confidence + b.confidence
  if (c === 0) return stv(0, 0)
  return stv((a.strength * a.confidence + b.strength * b.confidence) / c, clamp(c - a.confidence * b.confidence))
}
/** Expectation = strength × confidence — the scalar "how much do we believe this" weight. */
export const expectation = (tv: TruthValue): number => tv.strength * tv.confidence

// ── AttentionValue (ECAN) ──
export interface AttentionValue { sti: number; lti: number }
export const stimulate = (av: AttentionValue, amount: number): AttentionValue => ({ sti: av.sti + amount, lti: av.lti })
export const decay = (av: AttentionValue, rate = 0.9): AttentionValue => ({ sti: av.sti * rate, lti: av.lti })

/** Spread a fraction of each node's STI to its neighbours (Hebbian importance diffusion). */
export function spreadAttention(sti: Map<string, number>, adj: Map<string, string[]>, fraction = 0.5): Map<string, number> {
  const next = new Map(sti)
  for (const [id, s] of sti) {
    const nbrs = adj.get(id) ?? []
    if (nbrs.length === 0 || s <= 0) continue
    const give = (s * fraction) / nbrs.length
    next.set(id, Math.max(0, (next.get(id) ?? 0) - s * fraction))   // never drive STI negative on outflow
    for (const n of nbrs) next.set(n, (next.get(n) ?? 0) + give)
  }
  return next
}
/** Normalize STI to [0,1] (the attentional-focus signal). */
export function stiNorm(sti: Map<string, number>): Map<string, number> {
  const vals = [...sti.values()]
  const max = Math.max(1e-9, ...vals.map(Math.abs))
  return new Map([...sti].map(([id, s]) => [id, clamp(s / max)]))
}

// ── Truth-weighted, attention-personalized PageRank ──
export interface WeightedEdge { from: string; to: string; tv?: TruthValue }

export function weightedPageRank(
  nodes: string[], edges: WeightedEdge[],
  opts: { prior?: Map<string, number>; damping?: number; iterations?: number } = {},
): Map<string, number> {
  const damping = opts.damping ?? 0.85, iterations = opts.iterations ?? 60
  const n = nodes.length
  const out = new Map<string, number>()
  if (n === 0) return out
  const idx = new Map(nodes.map((id, i) => [id, i]))
  const outW: number[] = new Array(n).fill(0)
  const adj: Array<Array<{ j: number; w: number }>> = Array.from({ length: n }, () => [])
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to)
    if (a == null || b == null || a === b) continue   // skip self-loops (would double-inflate outW)
    const w = e.tv ? Math.max(1e-6, expectation(e.tv)) : 1   // belief-weighted edge
    adj[a]!.push({ j: b, w }); outW[a]! += w
    adj[b]!.push({ j: a, w }); outW[b]! += w
  }
  // teleport / personalization vector from the prior (e.g. normalized STI); uniform fallback
  const s = new Float64Array(n)
  let psum = 0
  for (let i = 0; i < n; i++) { const p = opts.prior?.get(nodes[i]!) ?? 0; s[i] = p; psum += p }
  if (psum <= 0) s.fill(1 / n); else for (let i = 0; i < n; i++) s[i]! /= psum
  let pr = Float64Array.from(s)
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(n)
    let dangling = 0
    for (let i = 0; i < n; i++) if (outW[i] === 0) dangling += pr[i]!
    for (let i = 0; i < n; i++) next[i] = (1 - damping) * s[i]! + damping * dangling * s[i]!
    for (let i = 0; i < n; i++) {
      if (outW[i] === 0) continue
      for (const { j, w } of adj[i]!) next[j]! += (damping * pr[i]! * w) / outW[i]!
    }
    pr = next
  }
  for (let i = 0; i < n; i++) out.set(nodes[i]!, Number(pr[i]!.toFixed(6)))
  return out
}

/**
 * link-suggest.ts — inline backlink suggestions while authoring (Reflect/Mem). Manual linking is the dropout
 * point in PKM ("links don't get made"); as the user writes, surface semantically-similar existing nodes to
 * one-click link. Over embeddings we already compute — pure ranking, the value is the authoring-moment nudge.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export interface Candidate { id: string; label: string; vec: number[] }

/** Top-K existing nodes most similar to the current note vector, excluding already-linked ids. */
export function suggestLinks(noteVec: number[], candidates: Candidate[], opts: { topK?: number; minSim?: number; alreadyLinked?: Set<string> } = {}): Array<{ id: string; label: string; sim: number }> {
  const topK = opts.topK ?? 5, minSim = opts.minSim ?? 0.5, linked = opts.alreadyLinked ?? new Set()
  return candidates
    .filter((c) => !linked.has(c.id))
    .map((c) => ({ id: c.id, label: c.label, sim: Number(cosine(noteVec, c.vec).toFixed(4)) }))
    .filter((c) => c.sim >= minSim)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
}

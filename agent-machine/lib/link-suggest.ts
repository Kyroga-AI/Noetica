/**
 * link-suggest.ts — inline backlink suggestions while authoring (Reflect/Mem). Manual linking is the dropout
 * point in PKM ("links don't get made"); as the user writes, surface semantically-similar existing nodes to
 * one-click link. Over embeddings we already compute — pure ranking, the value is the authoring-moment nudge.
 */
import { cosineSim as cosine } from './vec-sim.js'

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

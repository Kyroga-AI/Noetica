/**
 * vec-sim — the ONE cosine-similarity implementation.
 *
 * Five byte-identical private copies of `dot/(‖a‖‖b‖)` had drifted across the codebase (link-suggest,
 * solution-memory, late-interaction, vector-index, plus ollama's exported one). This is the canonical:
 * the most robust of them — accepts `number[]` or `Float32Array`, compares over the shorter length, and
 * the `Number.isFinite` guard rejects a NaN/Infinity element (injectable via stored-JSON vectors) so a
 * poisoned vector scores 0 rather than propagating NaN through every ranking.
 *
 * (lib/graph-search.ts keeps its OWN `cosineSim` deliberately: it bails on a length MISMATCH instead of
 * truncating — a different contract for the graph path — so it is intentionally not folded in here.)
 */
export function cosineSim(a: number[] | Float32Array, b: number[] | Float32Array): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) {
    const ai = a[i]!, bi = b[i]!
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) return 0
    dot += ai * bi; na += ai * ai; nb += bi * bi
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

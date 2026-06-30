/**
 * memory-bench — a memoryd retrieval benchmark (MemoryBench analog).
 *
 * The learning loop only compounds if memory recall actually improves. To know whether a change to
 * the embedder, the chunker, decay, or pinning HELPED, you need a repeatable score, not a vibe. This
 * harness scores any retriever against a labeled probe set: each probe is a query plus the ids of the
 * memories that SHOULD come back. It computes the standard IR metrics — recall@k, precision@k, MRR,
 * and nDCG@k — so two retrieval configs are directly comparable on the same probes.
 *
 * It is retriever-agnostic: pass a `Retriever` closure (lexical, vector, hybrid, RRF — whatever you're
 * testing) and the same probe set. No store, embedder, or network dependency lives here, which keeps
 * the benchmark itself deterministic and fast as a unit test.
 */

/** A retriever returns memory ids ranked best-first for a query. */
export type Retriever = (query: string, k: number) => Promise<string[]> | string[]

export interface Probe {
  query: string
  /** Ids of the memories that are relevant to this query (the gold set). */
  relevant: string[]
}

export interface ProbeScore {
  query: string
  recall: number
  precision: number
  /** Reciprocal rank of the first relevant hit (0 if none retrieved). */
  rr: number
  ndcg: number
  retrieved: string[]
}

export interface BenchResult {
  k: number
  probes: number
  /** Macro-averaged across probes. */
  recallAtK: number
  precisionAtK: number
  mrr: number
  ndcgAtK: number
  perProbe: ProbeScore[]
}

function recallAt(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 1 // nothing to find ⇒ trivially satisfied
  const top = retrieved.slice(0, k)
  const hits = top.filter((id) => relevant.has(id)).length
  return hits / relevant.size
}

function precisionAt(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k)
  if (top.length === 0) return 0
  const hits = top.filter((id) => relevant.has(id)).length
  return hits / top.length
}

function reciprocalRank(retrieved: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i]!)) return 1 / (i + 1)
  }
  return 0
}

/** Binary-relevance nDCG@k (gain 1 for a relevant hit, discounted by log2 of rank). */
function ndcgAt(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k)
  let dcg = 0
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i]!)) dcg += 1 / Math.log2(i + 2)
  }
  // Ideal DCG: every relevant item ranked first, up to min(k, |relevant|).
  const idealHits = Math.min(k, relevant.size)
  let idcg = 0
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2)
  return idcg === 0 ? 1 : dcg / idcg
}

/**
 * Run the benchmark: score `retriever` against `probes` at cutoff `k`.
 * Macro-averages each metric across probes.
 */
export async function runMemoryBench(
  retriever: Retriever,
  probes: Probe[],
  k = 5,
): Promise<BenchResult> {
  const perProbe: ProbeScore[] = []
  for (const probe of probes) {
    const retrieved = await retriever(probe.query, k)
    const relevant = new Set(probe.relevant)
    perProbe.push({
      query: probe.query,
      recall: recallAt(retrieved, relevant, k),
      precision: precisionAt(retrieved, relevant, k),
      rr: reciprocalRank(retrieved, relevant),
      ndcg: ndcgAt(retrieved, relevant, k),
      retrieved,
    })
  }
  const n = perProbe.length || 1
  const mean = (sel: (s: ProbeScore) => number): number =>
    perProbe.reduce((acc, s) => acc + sel(s), 0) / n
  return {
    k,
    probes: perProbe.length,
    recallAtK: mean((s) => s.recall),
    precisionAtK: mean((s) => s.precision),
    mrr: mean((s) => s.rr),
    ndcgAtK: mean((s) => s.ndcg),
    perProbe,
  }
}

/**
 * Compare two retrievers on the same probes — the actual question the learning loop asks
 * ("did this change help?"). Returns the deltas (b − a) on each headline metric.
 */
export async function compareRetrievers(
  a: Retriever,
  b: Retriever,
  probes: Probe[],
  k = 5,
): Promise<{ a: BenchResult; b: BenchResult; delta: { recall: number; precision: number; mrr: number; ndcg: number } }> {
  const [ra, rb] = await Promise.all([runMemoryBench(a, probes, k), runMemoryBench(b, probes, k)])
  return {
    a: ra,
    b: rb,
    delta: {
      recall: rb.recallAtK - ra.recallAtK,
      precision: rb.precisionAtK - ra.precisionAtK,
      mrr: rb.mrr - ra.mrr,
      ndcg: rb.ndcgAtK - ra.ndcgAtK,
    },
  }
}

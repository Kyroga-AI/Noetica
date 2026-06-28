/**
 * raptor.ts — RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval (Sarthi et al., 2024).
 *
 * Leaf-chunk retrieval answers "what does passage X say"; it CANNOT answer "summarize the whole topic" or
 * multi-document/global questions — the answer lives across many chunks, none of which individually contains it.
 * RAPTOR fixes this: embed chunks → cluster → LLM-summarize each cluster into a parent node → recurse, building
 * a tree whose upper levels hold progressively more abstract summaries. Retrieval then runs over the COLLAPSED
 * tree (all leaves AND summary nodes in one pool), so global/"Contextual Summarize" queries hit a summary node
 * while specific queries still hit a leaf. This is the missing piece behind GraphRAG-Bench's Contextual
 * Summarize question type (audit task #4).
 *
 * The embedder and summarizer are INJECTED (pluggable), so the tree-construction core is deterministic and
 * unit-testable with mocks — no live model needed. Production wires Ollama embed + a summarize prompt.
 */

export type Embedder = (texts: string[]) => Promise<number[][]>
export type Summarizer = (texts: string[]) => Promise<string>

export interface RaptorNode {
  id: string
  text: string
  level: number              // 0 = leaf chunk; higher = more abstract summary
  embedding: number[]
  childIds: string[]         // nodes this summary was built from (empty for leaves)
}

export interface RaptorTree {
  nodes: Map<string, RaptorNode>
  levels: string[][]         // levels[L] = node ids at level L
}

export interface RaptorOptions {
  maxClusterSize?: number    // branching: cluster grows until this size, then a new cluster seeds (default 5)
  maxLevels?: number         // stop recursing past this depth (default 4)
  minNodesToCluster?: number // stop when a level has <= this many nodes (default 2)
}

// ─── vector helpers ─────────────────────────────────────────────────────────
function norm(v: number[]): number[] {
  let s = 0
  for (const x of v) s += x * x
  const n = Math.sqrt(s) || 1
  return v.map((x) => x / n)
}
export function cosine(a: number[], b: number[]): number {
  let d = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) d += a[i]! * b[i]!
  return d
}

/**
 * Deterministic greedy clustering by cosine similarity. Walks nodes in order; each unclustered node seeds a
 * cluster and pulls its nearest still-unclustered neighbors that are ABOVE `minSim`, up to maxClusterSize.
 * Deterministic given input order (so tree construction is reproducible and testable) — a stand-in for RAPTOR's
 * soft GMM clustering that needs no UMAP/sklearn and degrades gracefully on tiny inputs. The minSim floor is
 * what makes it cluster by topic rather than just filling to the cap.
 */
export function clusterByEmbedding(embeddings: number[][], maxClusterSize = 5, minSim = 0.5): number[][] {
  const n = embeddings.length
  const unit = embeddings.map(norm)
  const used = new Array<boolean>(n).fill(false)
  const clusters: number[][] = []
  for (let i = 0; i < n; i++) {
    if (used[i]) continue
    used[i] = true
    const cluster = [i]
    // rank the remaining unclustered nodes by similarity to the seed, take the closest above the floor
    const cand = [] as Array<{ j: number; sim: number }>
    for (let j = i + 1; j < n; j++) if (!used[j]) cand.push({ j, sim: cosine(unit[i]!, unit[j]!) })
    cand.sort((a, b) => b.sim - a.sim)
    for (const { j, sim } of cand) {
      if (cluster.length >= maxClusterSize) break
      if (sim < minSim) break          // below the topic floor → not part of this cluster (rest are lower)
      used[j] = true
      cluster.push(j)
    }
    clusters.push(cluster)
  }
  return clusters
}

/** Build the RAPTOR tree from leaf chunks: cluster → summarize → recurse until a level collapses to a root. */
export async function buildRaptorTree(
  chunks: string[], embed: Embedder, summarize: Summarizer, opts: RaptorOptions = {},
): Promise<RaptorTree> {
  const maxClusterSize = opts.maxClusterSize ?? 5
  const maxLevels = opts.maxLevels ?? 4
  const minNodesToCluster = opts.minNodesToCluster ?? 2

  const nodes = new Map<string, RaptorNode>()
  const levels: string[][] = []
  let counter = 0
  const mk = (text: string, level: number, embedding: number[], childIds: string[]): RaptorNode => {
    const node: RaptorNode = { id: `r${level}_${counter++}`, text, level, embedding, childIds }
    nodes.set(node.id, node)
    return node
  }

  // level 0: the leaf chunks
  const leafEmb = chunks.length ? await embed(chunks) : []
  let current = chunks.map((c, i) => mk(c, 0, leafEmb[i] ?? [], []))
  levels.push(current.map((n) => n.id))

  // recurse upward
  for (let level = 1; level <= maxLevels; level++) {
    if (current.length <= minNodesToCluster) break
    const clusters = clusterByEmbedding(current.map((n) => n.embedding), maxClusterSize)
    if (clusters.length >= current.length) break  // no compression possible → stop (avoids infinite tree)
    const summaries = await Promise.all(clusters.map((c) => summarize(c.map((i) => current[i]!.text))))
    const summaryEmb = await embed(summaries)
    const next = clusters.map((c, k) =>
      mk(summaries[k]!, level, summaryEmb[k] ?? [], c.map((i) => current[i]!.id)))
    levels.push(next.map((n) => n.id))
    current = next
  }
  return { nodes, levels }
}

/**
 * Collapsed-tree retrieval (the mode RAPTOR found best): pool ALL nodes — leaves AND summaries — and return the
 * top-k by cosine to the query. Specific queries land on leaves; global/summarize queries land on summary nodes.
 */
export function collapsedRetrieve(tree: RaptorTree, queryEmbedding: number[], k = 8): RaptorNode[] {
  const q = norm(queryEmbedding)
  return [...tree.nodes.values()]
    .map((n) => ({ n, s: cosine(q, norm(n.embedding)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.n)
}

/** Tree stats for logging/inspection. */
export function treeStats(tree: RaptorTree): { levels: number; nodes: number; leaves: number; summaries: number } {
  const leaves = tree.levels[0]?.length ?? 0
  return { levels: tree.levels.length, nodes: tree.nodes.size, leaves, summaries: tree.nodes.size - leaves }
}

/**
 * knowledge-persist — the write-path from the knowledge projection to HellGraph, with content SEALED under the
 * user's root. The stored graph keeps full STRUCTURE (ids, kinds, edges, numeric props) so GDS/PageRank (hg_analytics)
 * can rank "the most central ideas in your workspace" — something Notion structurally can't do — while the human
 * CONTENT (labels/text) is vault-sealed, so the operator persists durable knowledge it cannot read. Durability +
 * GDS-real + compulsion resistance in one path.
 */
import { sealForScope, openForScope } from "./sovereign-vault.js";
import type { KGraph } from "./knowledge-graph.js";

const KSCOPE = "knowledge";

export interface StoredNode { id: string; kind: string; label_sealed: string; props: Record<string, number> }
export interface StoredEdge { from: string; to: string; type: string }

/** Pluggable graph backend (the real impl writes to HellGraph via /api/graph; tests inject an in-memory store). */
export interface GraphStore {
  upsertNode(n: StoredNode): void | Promise<void>;
  upsertEdge(e: StoredEdge): void | Promise<void>;
}

const numericProps = (p: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === "number") out[k] = v;
  return out;
};

/** Persist a projected workspace graph: structure in the clear (for GDS), content sealed under the root. */
export async function persistKnowledge(store: GraphStore, root: Buffer, g: KGraph): Promise<{ nodes: number; edges: number }> {
  for (const n of g.nodes)
    await store.upsertNode({ id: n.id, kind: n.kind, label_sealed: sealForScope(root, KSCOPE, n.label), props: numericProps(n.props) });
  for (const e of g.edges) await store.upsertEdge({ from: e.from, to: e.to, type: e.type });
  return { nodes: g.nodes.length, edges: g.edges.length };
}

/** Reveal a stored label — only possible with the user's root (edge-side). */
export function revealLabel(root: Buffer, n: StoredNode): string {
  return openForScope(root, KSCOPE, n.label_sealed).toString();
}

/**
 * In-degree centrality over STORED edges — proof that GDS ("which ideas are central?") runs on structure ALONE,
 * never touching plaintext. The production engine is hg_analytics (PageRank/Louvain/betweenness); this is the same
 * principle on the sealed graph: rank without decrypting a single block.
 */
export function centralityOverStored(edges: StoredEdge[], limit = 5): Array<{ id: string; score: number }> {
  const deg = new Map<string, number>();
  for (const e of edges) deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  return [...deg.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, limit);
}

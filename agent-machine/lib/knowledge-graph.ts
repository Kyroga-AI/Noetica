/**
 * knowledge-graph — the graph-native knowledge layer core (the Notion leapfrog).
 *
 * Docs are trees of BLOCKS; pages, databases, rows, blocks AND entities are first-class graph nodes; links,
 * containment, relations and mentions are EDGES. Notion bolts relations+rollups onto a page DB — a poor-man's graph.
 * We project documents onto a REAL graph, so the things Notion can only fake become first-class graph operations:
 *   • backlinks         = incoming LINKS_TO edges (automatic, cross-doc)
 *   • related discovery = graph neighbourhood (not a manual relation column)
 *   • rollups           = aggregate over connected nodes by edge type (arbitrary traversal, not one relation hop)
 *   • cross-doc queries = predicate over every block in the workspace (not per-database)
 *   • entity hubs       = a mention becomes one shared node many blocks point at → PageRank/community-detection-able
 *
 * This in-memory projection is exactly what we persist to HellGraph; computed + proven here so the editor, database
 * views, choir grounding, and scope-d governance all build on one model.
 */

export type BlockType = "page" | "heading" | "text" | "todo" | "bullet" | "database" | "row" | "ref";
export type EdgeType = "CONTAINS" | "LINKS_TO" | "MENTIONS" | "RELATES";

export interface Block {
  id: string;
  type: BlockType;
  text?: string;
  props?: Record<string, string | number | boolean>;
  children?: Block[];
}

export interface GNode { id: string; kind: BlockType | "entity"; label: string; props: Record<string, unknown> }
export interface GEdge { from: string; to: string; type: EdgeType }
export interface KGraph { nodes: GNode[]; edges: GEdge[] }

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const pageId = (title: string): string => "page:" + slug(title);
export const entityId = (name: string): string => "entity:" + slug(name);

/** Extract `[[wikilinks]]` and `@mentions` / `#tags` from block text. */
export function parseRefs(text: string): { links: string[]; mentions: string[] } {
  const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean);
  const mentions = [...text.matchAll(/(?:^|\s)[@#]([A-Za-z0-9][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
  return { links, mentions };
}

/** Project one document (a `page` block tree) into graph nodes + edges. */
export function projectDoc(page: Block): KGraph {
  if (page.type !== "page") throw new Error("projectDoc expects a 'page' block at the root");
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (n: GNode): void => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };

  const root = pageId(page.text ?? page.id);
  add({ id: root, kind: "page", label: page.text ?? page.id, props: page.props ?? {} });

  const walk = (b: Block, parentNodeId: string): void => {
    const nid = b.type === "page" ? pageId(b.text ?? b.id) : b.id;
    if (b !== page) {
      add({ id: nid, kind: b.type, label: b.text ?? b.id, props: b.props ?? {} });
      edges.push({ from: parentNodeId, to: nid, type: "CONTAINS" });
    }
    if (b.text) {
      const { links, mentions } = parseRefs(b.text);
      for (const l of links) {
        add({ id: pageId(l), kind: "page", label: l, props: { stub: true } }); // unresolved link → stub node (Roam-style)
        edges.push({ from: nid, to: pageId(l), type: "LINKS_TO" });
      }
      for (const m of mentions) {
        add({ id: entityId(m), kind: "entity", label: m, props: {} });
        edges.push({ from: nid, to: entityId(m), type: "MENTIONS" });
      }
    }
    if (b.props) for (const [k, v] of Object.entries(b.props))
      if (k.startsWith("rel:") && typeof v === "string") {
        add({ id: pageId(v), kind: "page", label: v, props: { stub: true } });
        edges.push({ from: nid, to: pageId(v), type: "RELATES" });
      }
    b.children?.forEach((c) => walk(c, nid));
  };
  walk(page, root);
  return { nodes, edges };
}

/** Merge many docs into the workspace graph; pages/entities with the same id dedupe into shared hub nodes. */
export function mergeGraphs(graphs: KGraph[]): KGraph {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  for (const g of graphs) {
    for (const n of g.nodes) { const ex = nodes.get(n.id); if (!ex || (ex.props?.["stub"] && !n.props?.["stub"])) nodes.set(n.id, n); } // real node supersedes a stub
    for (const e of g.edges) { const k = `${e.from}|${e.type}|${e.to}`; if (!seen.has(k)) { seen.add(k); edges.push(e); } } // dedupe edges
  }
  return { nodes: [...nodes.values()], edges };
}

// ── The superpowers (graph operations Notion can't do) ───────────────────────────────────────────────

/** Automatic, cross-doc backlinks: every block that LINKS_TO this page. */
export function backlinks(g: KGraph, pageTitle: string): GNode[] {
  const target = pageId(pageTitle);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.edges.filter((e) => e.type === "LINKS_TO" && e.to === target)
    .map((e) => byId.get(e.from)).filter((n): n is GNode => !!n);
}

/** Related discovery via the real graph: nodes within `hops` of `nodeId` along any edge. */
export function related(g: KGraph, nodeId: string, hops = 1): GNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const seen = new Set([nodeId]);
  let frontier = [nodeId];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const e of g.edges) {
      if (frontier.includes(e.from) && !seen.has(e.to)) { seen.add(e.to); next.push(e.to); }
      if (frontier.includes(e.to) && !seen.has(e.from)) { seen.add(e.from); next.push(e.from); }
    }
    frontier = next;
  }
  seen.delete(nodeId);
  return [...seen].map((id) => byId.get(id)).filter((n): n is GNode => !!n);
}

/** Graph-native rollup: aggregate a numeric prop over nodes connected from `nodeId` by `edgeType`. */
export function rollup(g: KGraph, nodeId: string, edgeType: EdgeType, prop: string, agg: "count" | "sum" | "avg"): number {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const targets = g.edges.filter((e) => e.type === edgeType && e.from === nodeId)
    .map((e) => byId.get(e.to)).filter((n): n is GNode => !!n);
  if (agg === "count") return targets.length;
  const vals = targets.map((n) => Number(n.props[prop])).filter((v) => !Number.isNaN(v));
  const sum = vals.reduce((a, b) => a + b, 0);
  return agg === "sum" ? sum : vals.length ? sum / vals.length : 0;
}

/** Cross-doc block query: every node in the workspace matching a predicate. */
export function query(g: KGraph, predicate: (n: GNode) => boolean): GNode[] {
  return g.nodes.filter(predicate);
}

/** PageRank over the workspace graph: "your most central ideas" — a real graph computation Notion can't do.
 *  (Production uses hg_analytics; this is the same algorithm for the in-memory/edge path.) */
export function pagerank(g: KGraph, opts: { iterations?: number; damping?: number } = {}): Array<{ id: string; score: number }> {
  const { iterations = 20, damping = 0.85 } = opts;
  const ids = g.nodes.map((n) => n.id);
  const N = ids.length || 1;
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of g.edges) out.get(e.from)?.push(e.to);
  let rank = new Map(ids.map((id) => [id, 1 / N]));
  for (let i = 0; i < iterations; i++) {
    const next = new Map(ids.map((id) => [id, (1 - damping) / N]));
    let dangling = 0;
    for (const id of ids) if (out.get(id)!.length === 0) dangling += (damping * rank.get(id)!) / N;
    for (const id of ids) {
      const outs = out.get(id)!;
      if (outs.length) { const share = (damping * rank.get(id)!) / outs.length; for (const t of outs) next.set(t, (next.get(t) ?? 0) + share); }
    }
    for (const id of ids) next.set(id, next.get(id)! + dangling);
    rank = next;
  }
  return ids.map((id) => ({ id, score: rank.get(id)! })).sort((a, b) => b.score - a.score);
}

/** Shortest path between two nodes (undirected) — "what connects A and B?", a question Notion has no answer for. */
export function pathBetween(g: KGraph, a: string, b: string): string[] | null {
  if (a === b) return [a];
  const adj = new Map<string, string[]>();
  const link = (x: string, y: string): void => { (adj.get(x) ?? adj.set(x, []).get(x)!).push(y); };
  for (const e of g.edges) { link(e.from, e.to); link(e.to, e.from); }
  const prev = new Map<string, string>();
  const seen = new Set([a]);
  const q = [a];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === b) break;
    for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); prev.set(nb, cur); q.push(nb); }
  }
  if (!seen.has(b)) return null;
  const path = [b];
  let c = b;
  while (c !== a) { c = prev.get(c)!; path.unshift(c); }
  return path;
}

/** Every block that mentions an entity, across all docs (the entity is a shared hub). */
export function mentionsOf(g: KGraph, entity: string): GNode[] {
  const target = entityId(entity);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.edges.filter((e) => e.type === "MENTIONS" && e.to === target)
    .map((e) => byId.get(e.from)).filter((n): n is GNode => !!n);
}

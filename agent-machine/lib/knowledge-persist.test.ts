/** Proofs for the sealed write-path: structure persists in the clear (GDS-real), content is sealed (compulsion-
 *  resistant), and centrality ranks "central ideas" without ever decrypting a block. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectDoc, mergeGraphs, pageId, entityId, type Block } from "./knowledge-graph.js";
import { persistKnowledge, revealLabel, centralityOverStored, type StoredNode, type StoredEdge, type GraphStore } from "./knowledge-persist.js";

const root = Buffer.alloc(32, 11);
const wrongRoot = Buffer.alloc(32, 12);

const docs: Block[] = [
  { id: "p1", type: "page", text: "Meeting Notes", children: [
    { id: "m2", type: "text", text: "Ship [[Sovereign Identity]] with @gus" },
  ] },
  { id: "p2", type: "page", text: "Roadmap", children: [
    { id: "r1", type: "text", text: "[[Sovereign Identity]] led by @gus" },
    { id: "r3", type: "row", text: "Identity", props: { effort: 8 } },
  ] },
  { id: "p3", type: "page", text: "Sovereign Identity", children: [] },
];

function memStore() {
  const nodes = new Map<string, StoredNode>();
  const edges: StoredEdge[] = [];
  const store: GraphStore = { upsertNode: (n) => { nodes.set(n.id, n); }, upsertEdge: (e) => { edges.push(e); } };
  return { store, nodes, edges };
}

test("persists full structure (for GDS) — node + edge counts match the projection", async () => {
  const g = mergeGraphs(docs.map(projectDoc));
  const { store, nodes, edges } = memStore();
  const r = await persistKnowledge(store, root, g);
  assert.equal(nodes.size, g.nodes.length);
  assert.equal(edges.length, g.edges.length);
  assert.equal(r.nodes, g.nodes.length);
});

test("COMPULSION RESISTANCE: stored labels are sealed; readable only with the user's root", async () => {
  const g = mergeGraphs(docs.map(projectDoc));
  const { store, nodes } = memStore();
  await persistKnowledge(store, root, g);
  const sid = nodes.get(pageId("Sovereign Identity"))!;
  assert.notEqual(sid.label_sealed, "Sovereign Identity", "label is ciphertext at rest");
  assert.equal(revealLabel(root, sid), "Sovereign Identity", "holder of the root can read it");
  assert.throws(() => revealLabel(wrongRoot, sid), "a compelled operator (no root) cannot read it");
});

test("numeric props survive for server-side rollups; text never stored in the clear", async () => {
  const g = mergeGraphs(docs.map(projectDoc));
  const { store, nodes } = memStore();
  await persistKnowledge(store, root, g);
  assert.equal(nodes.get("r3")!.props.effort, 8);
  for (const n of nodes.values()) assert.ok(!Object.values(n.props).some((v) => typeof v === "string"));
});

test("GDS WITHOUT PLAINTEXT: centrality ranks the most-linked idea using only sealed structure", async () => {
  const g = mergeGraphs(docs.map(projectDoc));
  const { store, edges } = memStore();
  await persistKnowledge(store, root, g);
  const top = centralityOverStored(edges, 3).map((x) => x.id);
  // Sovereign Identity (linked from both docs) and @gus (mentioned twice) outrank everything — computed on ciphertext graph
  assert.ok(top.includes(pageId("Sovereign Identity")));
  assert.ok(top.includes(entityId("gus")));
});

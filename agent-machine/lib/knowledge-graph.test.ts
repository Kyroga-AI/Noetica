/** Proofs for the graph-native knowledge layer: doc→graph projection, and the five operations Notion can only fake —
 *  automatic cross-doc backlinks, graph related-discovery, graph-native rollups, cross-doc block queries, entity hubs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectDoc, mergeGraphs, backlinks, related, rollup, query, mentionsOf, pagerank, pathBetween,
  pageId, entityId, parseRefs, type Block,
} from "./knowledge-graph.js";

const meeting: Block = {
  id: "b0", type: "page", text: "Meeting Notes",
  children: [
    { id: "b1", type: "heading", text: "Decisions" },
    { id: "b2", type: "text", text: "Ship [[Sovereign Identity]] with @gus this week" },
    { id: "b3", type: "todo", text: "Wire [[Mail Bridge]]", props: { done: false } },
  ],
};
const roadmap: Block = {
  id: "r0", type: "page", text: "Roadmap",
  children: [
    { id: "r1", type: "text", text: "Priority: [[Sovereign Identity]] led by @gus" },
    { id: "r2", type: "database", text: "Initiatives", children: [
      { id: "r3", type: "row", text: "Identity", props: { effort: 8, "rel:Sovereign Identity": "Sovereign Identity" } },
      { id: "r4", type: "row", text: "Knowledge", props: { effort: 5, "rel:Sovereign Identity": "Sovereign Identity" } },
    ] },
  ],
};

test("parseRefs extracts wikilinks and mentions", () => {
  const { links, mentions } = parseRefs("see [[Big Page]] and [[Two]] with @gus #urgent");
  assert.deepEqual(links, ["Big Page", "Two"]);
  assert.deepEqual(mentions, ["gus", "urgent"]);
});

test("projectDoc builds typed nodes + CONTAINS/LINKS_TO/MENTIONS edges", () => {
  const g = projectDoc(meeting);
  assert.ok(g.nodes.find((n) => n.id === pageId("Meeting Notes") && n.kind === "page"));
  assert.ok(g.edges.find((e) => e.type === "CONTAINS" && e.to === "b2"));
  assert.ok(g.edges.find((e) => e.type === "LINKS_TO" && e.to === pageId("Sovereign Identity")));
  assert.ok(g.edges.find((e) => e.type === "MENTIONS" && e.to === entityId("gus")));
});

test("BACKLINKS are automatic and cross-doc (Notion needs manual relations)", () => {
  const g = mergeGraphs([projectDoc(meeting), projectDoc(roadmap)]);
  const back = backlinks(g, "Sovereign Identity").map((n) => n.id);
  assert.ok(back.includes("b2"), "the meeting block links here");
  assert.ok(back.includes("r1"), "the roadmap block links here — across documents");
});

test("ENTITY HUB: one shared @gus node many blocks point at (PageRank-able)", () => {
  const g = mergeGraphs([projectDoc(meeting), projectDoc(roadmap)]);
  assert.equal(g.nodes.filter((n) => n.id === entityId("gus")).length, 1, "deduped to one hub");
  assert.equal(mentionsOf(g, "gus").length, 2, "two blocks across two docs mention gus");
});

test("GRAPH-NATIVE ROLLUP: aggregate effort over related rows by edge type", () => {
  const g = mergeGraphs([projectDoc(roadmap)]);
  // rows r3 + r4 both RELATE to Sovereign Identity; rollup their effort from the database node's rows via CONTAINS
  assert.equal(rollup(g, "r2", "CONTAINS", "effort", "sum"), 13, "8 + 5");
  assert.equal(rollup(g, "r2", "CONTAINS", "effort", "count"), 2);
});

test("RELATED discovery via the real graph neighbourhood", () => {
  const g = mergeGraphs([projectDoc(meeting), projectDoc(roadmap)]);
  // the Sovereign Identity page is reached by many; its 1-hop neighbourhood spans both docs' linking blocks
  const rel = related(g, pageId("Sovereign Identity"), 1).map((n) => n.id);
  assert.ok(rel.includes("b2") && rel.includes("r1"), "neighbours from both docs");
});

test("CROSS-DOC QUERY: every todo block in the workspace, not per-database", () => {
  const g = mergeGraphs([projectDoc(meeting), projectDoc(roadmap)]);
  const todos = query(g, (n) => n.kind === "todo");
  assert.equal(todos.length, 1);
  assert.equal(todos[0].id, "b3");
});

test("PAGERANK: 'most central ideas' — the cross-doc-linked page outranks a leaf (Notion can't compute this)", () => {
  const g = mergeGraphs([projectDoc(meeting), projectDoc(roadmap)]);
  const ranked = pagerank(g);
  const sid = ranked.findIndex((r) => r.id === pageId("Sovereign Identity"));
  const leaf = ranked.findIndex((r) => r.id === "b1"); // a lone heading
  assert.ok(sid >= 0 && sid < leaf, "the hub page ranks above an unlinked leaf");
});

test("PATHBETWEEN: 'what connects A and B?' — finds the chain across documents", () => {
  const g = mergeGraphs([projectDoc(meeting), projectDoc(roadmap)]);
  const path = pathBetween(g, "b2", "r1"); // meeting block ↔ roadmap block
  assert.ok(path && path.includes(pageId("Sovereign Identity")), "connected via the shared idea");
  assert.equal(pathBetween(g, "b2", entityId("nobody-here")), null, "no path → null");
});

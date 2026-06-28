/** Proofs for graph-grounded, governed choir AI: grounding from the real subgraph, prompt assembly, scope-d action
 *  gating, and structural anti-hallucination (citations must resolve to provided nodes). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectDoc, mergeGraphs, pageId, type Block } from "./knowledge-graph.js";
import { buildGroundedContext, assemblePrompt, gateAction, checkGrounding } from "./choir-grounding.js";

const docs: Block[] = [
  { id: "p1", type: "page", text: "Meeting Notes", children: [{ id: "m2", type: "text", text: "Ship [[Sovereign Identity]] with @gus" }] },
  { id: "p2", type: "page", text: "Sovereign Identity", children: [{ id: "i1", type: "text", text: "Unlinkable, compulsion-resistant. Owner @gus." }] },
];
const g = mergeGraphs(docs.map(projectDoc));

test("grounds the choir in the real subgraph — focus + neighbours become citations", () => {
  const gc = buildGroundedContext(g, pageId("Sovereign Identity"), { hops: 1 });
  const ids = gc.citations.map((c) => c.id);
  assert.ok(ids.includes(pageId("Sovereign Identity")), "includes the focus");
  assert.ok(gc.citations.length > 1, "pulled neighbours");
  assert.ok(gc.context.includes("[" + pageId("Sovereign Identity") + "]"), "context cites by id");
});

test("prompt carries the grounded context + the citation directive", () => {
  const gc = buildGroundedContext(g, pageId("Meeting Notes"));
  const p = assemblePrompt("ask", "Who owns identity?", gc);
  assert.ok(p.includes("Grounded context") && p.includes("Cite node ids"));
  assert.ok(p.includes("Who owns identity?"));
});

test("GOVERNED: read-only policy allows ask/summarize, denies draft/restructure", () => {
  const ro = { read: true, write: false, egress: false };
  assert.equal(gateAction("ask", ro).allowed, true);
  assert.equal(gateAction("summarize", ro).allowed, true);
  assert.equal(gateAction("draft", ro).allowed, false);
  assert.equal(gateAction("restructure", { read: true, write: true, egress: false }).allowed, true);
  assert.equal(gateAction("ask", { read: false, write: false, egress: false }).allowed, false);
});

test("ANTI-HALLUCINATION: an answer citing an unknown id is flagged ungrounded", () => {
  const gc = buildGroundedContext(g, pageId("Sovereign Identity"));
  const good = `It's owned by @gus [${pageId("Sovereign Identity")}].`;
  assert.equal(checkGrounding(good, gc).grounded, true);
  const bad = "Per [page:made-up-source], the answer is X.";
  const r = checkGrounding(bad, gc);
  assert.equal(r.grounded, false);
  assert.ok(r.unknownCitations.includes("page:made-up-source"));
});

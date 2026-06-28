/**
 * choir-grounding — wire the sovereign choir into the apps the RIGHT way: grounded in the real knowledge graph and
 * governed by scope-d. Unlike a bolt-on chatbot over a vector blur, the choir answers from a subgraph of actual
 * nodes, CITES them by id, and its write actions are gated by policy. "AI-native" the way Nextcloud/Zoho can't:
 * real graph grounding + governed + on sovereign models. Anti-hallucination is structural (citations must resolve).
 */
import { type KGraph, type GNode, related } from "./knowledge-graph.js";

export type ChoirAction = "ask" | "summarize" | "draft" | "restructure";

export interface GroundedContext { focus: string; context: string; citations: GNode[] }

/** Build a grounded context from the graph neighbourhood of a focus node — the citations the choir may use. */
export function buildGroundedContext(g: KGraph, focusNodeId: string, opts: { hops?: number; max?: number } = {}): GroundedContext {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const cites = new Map<string, GNode>();
  const focus = byId.get(focusNodeId);
  if (focus) cites.set(focus.id, focus);
  for (const n of related(g, focusNodeId, opts.hops ?? 1)) cites.set(n.id, n);
  const citations = [...cites.values()].slice(0, opts.max ?? 12);
  const context = citations.map((n) => `- [${n.id}] (${n.kind}) ${n.label}`).join("\n");
  return { focus: focusNodeId, context, citations };
}

const HEAD: Record<ChoirAction, string> = {
  ask: "Answer the question using ONLY the grounded context. Cite node ids in [brackets]. If the answer isn't in the context, say you don't know.",
  summarize: "Summarize the grounded context faithfully. Cite the node ids in [brackets].",
  draft: "Draft new content for the focus, consistent with the grounded context. Cite the node ids you build on.",
  restructure: "Propose a restructuring of the focus using the grounded context. Cite the node ids in [brackets].",
};

/** Assemble the choir prompt: instruction + the grounded subgraph + the task. */
export function assemblePrompt(action: ChoirAction, question: string, grounded: GroundedContext): string {
  return `${HEAD[action]}\n\n# Grounded context (knowledge graph)\n${grounded.context}\n\n# Task\n${question || action}`;
}

/** scope-d-governed gating: which choir actions a policy permits. */
export interface ChoirPolicy { read: boolean; write: boolean; egress: boolean }
export function gateAction(action: ChoirAction, policy: ChoirPolicy): { allowed: boolean; reason: string } {
  if (!policy.read) return { allowed: false, reason: "read not permitted by policy" };
  const isWrite = action === "draft" || action === "restructure";
  if (isWrite && !policy.write) return { allowed: false, reason: `${action} requires write policy (scope-d)` };
  return { allowed: true, reason: "permitted" };
}

/** Structural anti-hallucination: every [id] the answer cites must be in the grounded context, else it's flagged. */
export function checkGrounding(answer: string, grounded: GroundedContext): { grounded: boolean; unknownCitations: string[] } {
  const allowed = new Set(grounded.citations.map((c) => c.id));
  const cited = [...answer.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const unknownCitations = [...new Set(cited.filter((id) => !allowed.has(id)))];
  return { grounded: unknownCitations.length === 0, unknownCitations };
}

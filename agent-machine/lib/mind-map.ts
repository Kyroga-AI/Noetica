/**
 * mind-map.ts — hierarchical topic-decomposition (NotebookLM Mind Maps). Our force-directed graph shows
 * entity RELATIONSHIPS; a mind map is a generated, hierarchical, top-down decomposition for UNDERSTANDING a
 * body of material — a different cognitive tool (orienting in a new corpus). Builds a tree from parent→child
 * topic edges (the LLM proposes the hierarchy; this assembles + renders it).
 */
export interface MindNode { topic: string; children: MindNode[] }

/** Assemble a tree from parent→child edges rooted at `root`. Cycle-guarded. */
export function buildMindMap(root: string, edges: Array<{ parent: string; child: string }>, seen: Set<string> = new Set()): MindNode {
  if (seen.has(root)) return { topic: root, children: [] }
  seen.add(root)
  const children = edges.filter((e) => e.parent === root).map((e) => buildMindMap(e.child, edges, seen))
  return { topic: root, children }
}

/** Flatten to an indented outline (topic + depth) for rendering. */
export function flattenOutline(node: MindNode, depth = 0): Array<{ topic: string; depth: number }> {
  return [{ topic: node.topic, depth }, ...node.children.flatMap((c) => flattenOutline(c, depth + 1))]
}

export function countNodes(node: MindNode): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0)
}

/**
 * person-graph-snapshot — project the REAL managed HellGraph (via selectSurface) into the
 * cockpit's PersonGraphSnapshot shape, so the socioprophet client-vue PersonGraph surface
 * (personGraphApi → /person-graph/snapshot) renders LIVE graph data instead of its fixture.
 *
 * The client keeps opaque identity strings and never calls HellGraph directly — this backend
 * is the "live graph adapter" that resolves them. Pure + dependency-injectable for testing.
 */
import type { SurfaceResult } from './graph-surface.js';

// Mirror socioprophet client-vue runtime-adapters/knowledgeGraphClient.ts (the shape the
// cockpit's personGraphApi consumes). Kept structurally identical so the surface renders it.
export interface KGNode {
  id: string;
  label: string;
  kind: string;
  properties: Record<string, string | number | boolean>;
  provenance_refs: string[];
}
export interface KGEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  label: string;
  properties: Record<string, string | number | boolean>;
  provenance_refs: string[];
}
export interface KGSummary {
  operation: 'knowledge_graph.summary.get';
  health: 'ok' | 'degraded' | 'unavailable';
  node_count: number;
  edge_count: number;
  mockBoundary: true;
  evidence_level: 'E1';
  degraded_reason?: string;
}
export interface PersonGraphSnapshot {
  summary: KGSummary;
  self: KGNode;
  nodes: KGNode[];
  edges: KGEdge[];
}

const SELF: KGNode = { id: 'self', label: 'Self', kind: 'Self', properties: {}, provenance_refs: [] };

/** Project a legible surface subgraph (from the real HellGraph) into a PersonGraphSnapshot. */
export function toPersonGraphSnapshot(surface: SurfaceResult): PersonGraphSnapshot {
  const nodes: KGNode[] = surface.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind || n.category || 'Entity',
    properties: { category: n.category, kvClass: n.kvClass, degree: n.degree, featured: n.featured },
    provenance_refs: [],
  }));
  const edges: KGEdge[] = surface.links.map((l) => ({
    id: `${l.source}|${l.dimension || l.epistemic || 'relatedTo'}|${l.target}`,
    source: l.source,
    target: l.target,
    predicate: l.dimension || l.epistemic || 'relatedTo',
    label: l.dimension || l.epistemic || '',
    properties: { primary: l.primary, epistemic: l.epistemic, dimension: l.dimension },
    provenance_refs: [],
  }));

  // Self = the graph's most-connected entity (the natural centre of a person's graph),
  // or a synthesized anchor when the graph is empty.
  const self = nodes.length
    ? nodes.reduce((a, b) =>
        ((b.properties['degree'] as number) ?? 0) > ((a.properties['degree'] as number) ?? 0) ? b : a)
    : SELF;

  const health: KGSummary['health'] = nodes.length ? 'ok' : 'unavailable';
  const summary: KGSummary = {
    operation: 'knowledge_graph.summary.get',
    health,
    node_count: nodes.length,
    edge_count: edges.length,
    mockBoundary: true,
    evidence_level: 'E1',
    ...(nodes.length ? {} : { degraded_reason: 'empty_graph' }),
  };
  return { summary, self, nodes, edges };
}

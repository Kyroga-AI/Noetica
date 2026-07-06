/** Proofs for the person-graph snapshot projection: real surface → cockpit PersonGraphSnapshot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPersonGraphSnapshot } from './person-graph-snapshot.js';
import type { SurfaceResult } from './graph-surface.js';

const surface = (over: Partial<SurfaceResult> = {}): SurfaceResult => ({
  nodes: [
    { id: 'a', label: 'Ada', category: 'trust', kind: 'Person', kvClass: 'k', featured: true, degree: 5 },
    { id: 'b', label: 'Repo X', category: 'technical', kind: 'Code', kvClass: 'k', featured: false, degree: 2 },
  ],
  links: [{ source: 'a', target: 'b', primary: true, epistemic: 'extracted', dimension: 'authoredBy' }],
  total: { nodes: 2, edges: 1 },
  ...over,
});

test('projects nodes + edges into the cockpit KG shape', () => {
  const s = toPersonGraphSnapshot(surface());
  assert.equal(s.nodes.length, 2);
  assert.equal(s.edges.length, 1);
  const a = s.nodes.find((n) => n.id === 'a')!;
  assert.equal(a.label, 'Ada');
  assert.equal(a.kind, 'Person');
  assert.equal(a.properties['degree'], 5);
  assert.ok(Array.isArray(a.provenance_refs));
  const e = s.edges[0]!;
  assert.equal(e.source, 'a');
  assert.equal(e.target, 'b');
  assert.equal(e.predicate, 'authoredBy');
  assert.equal(e.id, 'a|authoredBy|b');
});

test('self is the most-connected entity', () => {
  const s = toPersonGraphSnapshot(surface());
  assert.equal(s.self.id, 'a'); // degree 5 > 2
});

test('summary reports live health + counts', () => {
  const s = toPersonGraphSnapshot(surface());
  assert.equal(s.summary.health, 'ok');
  assert.equal(s.summary.node_count, 2);
  assert.equal(s.summary.edge_count, 1);
  assert.equal(s.summary.evidence_level, 'E1');
});

test('empty graph degrades cleanly (synthesized self, unavailable)', () => {
  const s = toPersonGraphSnapshot(surface({ nodes: [], links: [], total: { nodes: 0, edges: 0 } }));
  assert.equal(s.self.id, 'self');
  assert.equal(s.summary.health, 'unavailable');
  assert.equal(s.summary.degraded_reason, 'empty_graph');
  assert.equal(s.nodes.length, 0);
});

test('kind falls back category → Entity when kind is blank', () => {
  const s = toPersonGraphSnapshot(surface({
    nodes: [{ id: 'c', label: 'X', category: 'docs', kind: '', kvClass: '', featured: false, degree: 1 }],
    links: [],
  }));
  assert.equal(s.nodes[0]!.kind, 'docs');
});

/** graph-replica — capture local structure → ops, and apply converged structure → graph. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReplica, presentNodes } from './sync-engine.js'
import { captureGraphIntoReplica, applyReplicaToGraph, type GraphLike } from './graph-replica.js'

function fakeGraph() {
  const nodes = new Map<string, string[]>()
  const edges: Array<{ from: string; label: string; to: string }> = []
  const g: GraphLike = {
    allNodes: () => [...nodes.keys()].map((id) => ({ id })),
    allEdges: () => edges,
    addNode: (id, labels) => nodes.set(id, labels),
    addEdge: (label, from, to) => { edges.push({ from, label, to }) },
  }
  return g
}

test('capture: local graph structure → CRDT ops (idempotent)', () => {
  const g = fakeGraph()
  g.addNode('a', ['x']); g.addNode('b', ['x']); g.addEdge('rel', 'a', 'b')
  const r = createReplica('r1')
  assert.equal(captureGraphIntoReplica(r, g), 3)       // 2 nodes + 1 edge
  assert.deepEqual(presentNodes(r).sort(), ['a', 'b'])
  assert.equal(captureGraphIntoReplica(r, g), 0)       // idempotent
})

test('apply: converged replica structure → graph, preserving edge labels (idempotent)', () => {
  const g1 = fakeGraph()
  g1.addNode('a', ['x']); g1.addNode('b', ['x']); g1.addEdge('rel', 'a', 'b')
  const r = createReplica('r1'); captureGraphIntoReplica(r, g1)
  const g2 = fakeGraph()
  assert.equal(applyReplicaToGraph(r, g2), 3)          // peer data lands
  assert.deepEqual(g2.allNodes().map((x) => x.id).sort(), ['a', 'b'])
  assert.equal(g2.allEdges().length, 1)
  assert.equal(g2.allEdges()[0]!.label, 'rel')         // label preserved through the CRDT
  assert.equal(applyReplicaToGraph(r, g2), 0)          // idempotent
})

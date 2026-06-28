/** Tests for refresh-framework Phase 0: the content fingerprint (correctness backstop) + change capture. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { topologyFingerprint, instrumentGraph, graphRevision, snapshotDirty, clearDirty, _resetRevisionStateForTest } from './graph-revision.js'

test('topologyFingerprint is invariant to ordering', () => {
  const a = topologyFingerprint(['n1', 'n2', 'n3'], [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }])
  const b = topologyFingerprint(['n3', 'n1', 'n2'], [{ from: 'n2', to: 'n3' }, { from: 'n1', to: 'n2' }])
  assert.equal(a, b)
})

test('topologyFingerprint busts on add-one + prune-one — the exact count-sig bug', () => {
  const before = topologyFingerprint(['a', 'b', 'c'], [])
  const after = topologyFingerprint(['a', 'b', 'd'], []) // same count (3), different membership
  assert.notEqual(before, after)
})

test('topologyFingerprint busts on edge rewire at constant node/edge counts', () => {
  const before = topologyFingerprint(['a', 'b', 'c'], [{ from: 'a', to: 'b' }])
  const after = topologyFingerprint(['a', 'b', 'c'], [{ from: 'a', to: 'c' }])
  assert.notEqual(before, after)
})

test('topologyFingerprint is stable across identical inputs', () => {
  assert.equal(
    topologyFingerprint(['a', 'b'], [{ from: 'a', to: 'b' }]),
    topologyFingerprint(['a', 'b'], [{ from: 'a', to: 'b' }]),
  )
})

test('instrumentGraph captures mutations: revision bumps + dirty ids recorded, originals still run', () => {
  _resetRevisionStateForTest()
  const calls: string[] = []
  const store = {
    addNode: (id: string) => { calls.push('addNode:' + id); return {} },
    addEdge: (label: string, from: string, to: string) => { calls.push(`addEdge:${from}-${to}`); return {} },
    setNodeProperty: (id: string, _k: string, _v: unknown) => { calls.push('setProp:' + id) },
  }
  instrumentGraph(store)
  const r0 = graphRevision()
  store.addNode('x')
  store.addEdge('REL', 'x', 'y')
  store.setNodeProperty('x', 'k', 1)
  assert.ok(graphRevision() > r0, 'revision advanced')
  const d = snapshotDirty()
  assert.ok(d.nodes.includes('x') && d.nodes.includes('y'), 'dirty nodes recorded (incl. edge endpoints)')
  assert.ok(d.edges.length === 1 && d.edges[0].includes('x') && d.edges[0].includes('y'), 'dirty edge recorded')
  assert.deepEqual(calls, ['addNode:x', 'addEdge:x-y', 'setProp:x'], 'wrapped, not replaced')
  clearDirty()
  assert.equal(snapshotDirty().nodes.length, 0, 'clearDirty resets the accumulator')
})

test('instrumentGraph is idempotent — no double-bump', () => {
  _resetRevisionStateForTest()
  let n = 0
  const store = { addNode: (_id: string) => { n++; return {} } }
  instrumentGraph(store)
  instrumentGraph(store) // second call must be a no-op
  const r0 = graphRevision()
  store.addNode('z')
  assert.equal(graphRevision(), r0 + 1, 'bumped exactly once')
  assert.equal(n, 1, 'original ran exactly once')
})

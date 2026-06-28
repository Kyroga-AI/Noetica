/** Convergence property tests for the S0 op-based CRDT sync core. Proves the merge rules, not asserts them. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createReplica, addNode, removeNode, addEdge, setProp,
  delta, merge, fingerprint, presentNodes, getProp,
} from './sync-engine.js'

/** Exchange all pending ops both ways until both replicas have seen everything. */
function syncBoth(a: ReturnType<typeof createReplica>, b: ReturnType<typeof createReplica>): void {
  merge(b, delta(a, b.vv))
  merge(a, delta(b, a.vv))
}

test('disjoint edits converge to identical state', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n1'); addNode(a, 'n2'); addEdge(a, 'n1', 'REL', 'n2')
  addNode(b, 'n3'); setProp(b, 'n3', 'color', 'red')
  syncBoth(a, b)
  assert.deepEqual(presentNodes(a), presentNodes(b))
  assert.deepEqual(presentNodes(a), ['n1', 'n2', 'n3'])
  assert.equal(fingerprint(a), fingerprint(b), 'converged')
})

test('merge is idempotent — applying the same delta twice changes nothing', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n1'); setProp(a, 'n1', 'k', 1)
  const d = delta(a, b.vv)
  merge(b, d); const fp1 = fingerprint(b)
  merge(b, d); merge(b, d)
  assert.equal(fingerprint(b), fp1, 'replaying the delta is a no-op')
})

test('order-independent — applying two peers’ deltas in either order converges', () => {
  const a = createReplica('A'), c = createReplica('C')
  addNode(a, 'x'); addNode(c, 'z')
  const left = createReplica('L'); merge(left, delta(a, left.vv)); merge(left, delta(c, left.vv))
  const right = createReplica('R'); merge(right, delta(c, right.vv)); merge(right, delta(a, right.vv))
  assert.equal(fingerprint(left), fingerprint(right), 'commutative merge')
  assert.deepEqual(presentNodes(left), ['x', 'z'])
})

test('LWW property — concurrent writes to the same prop converge to the higher (lamport, replica)', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n'); syncBoth(a, b)
  setProp(a, 'n', 'status', 'draft')   // A: lamport 1
  setProp(b, 'n', 'status', 'final')   // B: lamport 1 (concurrent) → tie-break by replica id; 'B' > 'A' so B wins
  syncBoth(a, b)
  assert.equal(getProp(a, 'n', 'status'), getProp(b, 'n', 'status'), 'converged')
  assert.equal(getProp(a, 'n', 'status'), 'final', 'higher replica id wins the tie')
})

test('add-wins — concurrent remove vs re-add keeps the node (add wins)', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n'); syncBoth(a, b)
  removeNode(a, 'n')           // A removes (observing A’s add-tag)
  addNode(b, 'n')              // B concurrently re-adds (a NEW tag A hasn’t observed)
  syncBoth(a, b)
  assert.deepEqual(presentNodes(a), ['n'], 'add-wins: the concurrent re-add survives the remove')
  assert.equal(fingerprint(a), fingerprint(b), 'converged')
})

test('sequential remove after observed add deletes the node', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n'); syncBoth(a, b)
  removeNode(b, 'n')           // B observed A’s add → removes it cleanly
  syncBoth(a, b)
  assert.deepEqual(presentNodes(a), [], 'node removed on both')
  assert.equal(fingerprint(a), fingerprint(b))
})

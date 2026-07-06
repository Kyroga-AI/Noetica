/** S0 anti-entropy protocol tests: the round-trip converges over the (loopback) transport, not just the merge. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReplica, addNode, addEdge, setProp, fingerprint, presentNodes, getProp } from './sync-engine.js'
import { antiEntropy, handleSync, loopbackPair, syncOver } from './sync-transport.js'

test('one anti-entropy round reconciles disjoint edits both directions', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n1'); addEdge(a, 'n1', 'REL', 'n2'); addNode(a, 'n2')
  addNode(b, 'n3'); setProp(b, 'n3', 'k', 7)
  antiEntropy(a, b)
  assert.equal(fingerprint(a), fingerprint(b), 'converged after one round')
  assert.deepEqual(presentNodes(a), ['n1', 'n2', 'n3'])
  assert.equal(getProp(a, 'n3', 'k'), 7, 'props synced too')
})

test('repeated rounds stay converged as edits continue (incremental sync)', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'x'); antiEntropy(a, b)
  addNode(b, 'y'); antiEntropy(a, b)
  setProp(a, 'x', 'v', 1); antiEntropy(a, b)
  assert.equal(fingerprint(a), fingerprint(b))
  assert.deepEqual(presentNodes(a), ['x', 'y'])
})

test('a no-op round (already converged) sends no deltas back', () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(a, 'n'); antiEntropy(a, b)
  // now both equal; an announce from a must yield deltas:[] and the reply chain terminates
  const reply = handleSync(b, { kind: 'announce', from: a.id, vv: Object.fromEntries(a.vv) })
  assert.ok(reply && reply.kind === 'deltas' && reply.ops.length === 0, 'nothing to ship when converged')
})

test('loopback transport delivers an announce and the peer replies with the missing ops', async () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(b, 'fromB')
  const [ta, tb] = loopbackPair()
  // b answers inbound messages; a kicks off by announcing its (empty) vv
  tb.onMessage((m) => { const r = handleSync(b, m); if (r) void tb.send(r) })
  let received = 0
  ta.onMessage((m) => { if (m.kind === 'deltas') { received = m.ops.length; handleSync(a, m) } })
  await ta.send({ kind: 'announce', from: a.id, vv: {} })
  assert.ok(received >= 1, 'peer shipped its op over the transport')
  assert.deepEqual(presentNodes(a), ['fromB'], 'edge replica absorbed the peer op')
})

test('syncOver wires the reply handler + announces', async () => {
  const a = createReplica('A'), b = createReplica('B')
  addNode(b, 'q')
  const [ta, tb] = loopbackPair()
  tb.onMessage((m) => { const r = handleSync(b, m); if (r) void tb.send(r) })
  await syncOver(a, ta)
  assert.deepEqual(presentNodes(a), ['q'])
})

/** http-sync — the real network wire: two replicas converge over (mocked) HTTP anti-entropy. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReplica, addNode, addEdge, presentNodes, fingerprint } from './sync-engine.js'
import { handlePeerSync, syncWithPeer, syncConfig } from './http-sync.js'

/** A fetch that IS peer `b`'s POST /api/graph/sync endpoint. */
function peerFetch(b: ReturnType<typeof createReplica>): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const msg = JSON.parse(init.body as string)
    const reply = handlePeerSync(b, msg)
    return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

test('two replicas CONVERGE over the HTTP wire (delta anti-entropy, real)', async () => {
  const a = createReplica('a'); const b = createReplica('b')
  addNode(a, 'n1'); addNode(a, 'n2'); addEdge(a, 'n1', 'rel', 'n2')
  addNode(b, 'n3')
  const r = await syncWithPeer(a, 'http://peer-b', { fetchImpl: peerFetch(b) })
  assert.ok(r.ok)
  assert.ok(r.received >= 1 && r.sent >= 1)       // both directions exchanged ops
  assert.deepEqual(presentNodes(a).sort(), ['n1', 'n2', 'n3'])
  assert.deepEqual(presentNodes(b).sort(), ['n1', 'n2', 'n3'])
  assert.equal(fingerprint(a), fingerprint(b))    // provably converged
})

test('idempotent: a second round exchanges nothing and stays converged', async () => {
  const a = createReplica('a'); const b = createReplica('b')
  addNode(a, 'x'); addNode(b, 'y')
  await syncWithPeer(a, 'http://b', { fetchImpl: peerFetch(b) })
  const second = await syncWithPeer(a, 'http://b', { fetchImpl: peerFetch(b) })
  assert.equal(second.received, 0)
  assert.equal(fingerprint(a), fingerprint(b))
})

test('fail-open: an unreachable/erroring peer never throws', async () => {
  const a = createReplica('a'); addNode(a, 'n')
  const errFetch = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch
  const r = await syncWithPeer(a, 'http://down', { fetchImpl: errFetch })
  assert.equal(r.ok, false)
  assert.deepEqual(presentNodes(a), ['n'])        // local state intact
})

test('opt-in: syncConfig null unless GRAPH_SYNC_* is set', () => {
  delete process.env.GRAPH_SYNC_PEERS
  assert.equal(syncConfig(), null)
})

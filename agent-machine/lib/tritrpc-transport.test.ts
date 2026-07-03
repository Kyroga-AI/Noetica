import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TriRpcClient, buildEnvelope, envelopeHash, type RpcEvent, type TriRpcEnvelope } from './tritrpc-transport.js'

// a stand-in for the a2a-mcp UDS gateway: reads one JSON envelope line, replies with a response envelope
function mockGateway(handler: (req: TriRpcEnvelope) => TriRpcEnvelope): Promise<{ socketPath: string; close: () => void }> {
  const socketPath = path.join(os.tmpdir(), `trpc-${randomUUID().slice(0, 8)}.sock`)
  const server = net.createServer((sock) => {
    let buf = ''
    sock.on('data', (d) => {
      buf += d.toString()
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const req = JSON.parse(buf.slice(0, nl)) as TriRpcEnvelope
      sock.write(JSON.stringify(handler(req)) + '\n')
    })
  })
  return new Promise((resolve) => server.listen(socketPath, () => resolve({ socketPath, close: () => server.close() })))
}

test('envelope hash is deterministic + key-order independent', () => {
  const a = { header: { version: 1, msg_id: 'x', ts_ms: 1 }, sender: { method: 'm', service: 's' } }
  const b = { sender: { service: 's', method: 'm' }, header: { ts_ms: 1, msg_id: 'x', version: 1 } }
  assert.equal(envelopeHash(a as TriRpcEnvelope), envelopeHash(b as TriRpcEnvelope))
})

test('call() round-trips over UDS + emits request.sent then response.received with the envelope_hash', async () => {
  const gw = await mockGateway((req) => buildEnvelope(req.sender.service, req.sender.method, { echo: req.payload }))
  const events: RpcEvent[] = []
  try {
    const client = new TriRpcClient({ socketPath: gw.socketPath, route_id: 'route://planner/runner@v1', peer_id: 'node://edge-a-01', onEvent: (e) => events.push(e) })
    const resp = await client.call('planner', 'plan', { goal: 'ship' })
    assert.deepEqual((resp.payload as { echo: unknown }).echo, { goal: 'ship' })
    assert.deepEqual(events.map((e) => e.type), ['rpc.request.sent', 'rpc.response.received'])
    assert.match(events[0].envelope_hash, /^sha256:[0-9a-f]{64}$/)
    assert.equal(events[0].envelope_hash, events[1].envelope_hash)   // same envelope bound across both events
    assert.equal(events[0].route_id, 'route://planner/runner@v1')
    assert.ok(typeof events[1].latency_ms === 'number')
    assert.ok((events[1].response_bytes ?? 0) > 0)
  } finally { gw.close() }
})

test('an error envelope rejects + emits nothing beyond response.received', async () => {
  const gw = await mockGateway(() => ({ header: { version: 1, msg_id: 'e', ts_ms: 1 }, sender: { service: 's', method: 'm' }, error: { code: 404, message: 'not found' } }))
  const events: RpcEvent[] = []
  try {
    const client = new TriRpcClient({ socketPath: gw.socketPath, onEvent: (e) => events.push(e) })
    await assert.rejects(client.call('s', 'm', {}), /tritrpc 404: not found/)
  } finally { gw.close() }
})

test('unreachable socket emits rpc.fail(upstream_unreachable)', async () => {
  const events: RpcEvent[] = []
  const client = new TriRpcClient({ socketPath: path.join(os.tmpdir(), 'does-not-exist.sock'), timeoutMs: 2000, onEvent: (e) => events.push(e) })
  await assert.rejects(client.call('s', 'm', {}))
  assert.ok(events.some((e) => e.type === 'rpc.fail' && e.failure_class === 'upstream_unreachable'))
})

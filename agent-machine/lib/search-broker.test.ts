import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { searchLocal, searchPlatform, search, type Fetchish } from './search-broker.js'

// stand-in lampstand: one JSON-line request → one JSON-line SearchResponse
function mockLampstand(resp: unknown): Promise<{ socketPath: string; close: () => void }> {
  const socketPath = path.join(os.tmpdir(), `lamp-${randomUUID().slice(0, 8)}.sock`)
  const server = net.createServer((sock) => {
    let buf = ''
    sock.on('data', (d) => { buf += d.toString(); if (buf.includes('\n')) sock.write(JSON.stringify(resp) + '\n') })
  })
  return new Promise((r) => server.listen(socketPath, () => r({ socketPath, close: () => server.close() })))
}

test('with no external endpoints, Local falls back to on-device search; platform stays unconfigured', async () => {
  const r = await search('x', 'all', {})
  // Local no longer reports "not configured" — with no lampstand socket it searches Noetica's own
  // on-device doc/memory store (empty in this test env → ok:true, configured:true, zero hits).
  assert.equal(r.local.configured, true)
  assert.equal(r.local.ok, true)
  // Platform (sherlock) still requires SHERLOCK_URL.
  assert.equal(r.platform.configured, false)
})

test('searchLocal consumes lampstand and maps hits', async () => {
  const gw = await mockLampstand({ result: { hits: [{ path: '/home/m/notes.md', snippet: 'the deploy runbook', score: 0.9 }] } })
  try {
    const r = await searchLocal('deploy', gw.socketPath)
    assert.equal(r.ok, true)
    assert.equal(r.hits.length, 1)
    assert.equal(r.hits[0].source, 'local')
    assert.equal(r.hits[0].ref, '/home/m/notes.md')
    assert.equal(r.hits[0].snippet, 'the deploy runbook')
  } finally { gw.close() }
})

test('searchPlatform maps the sherlock evidence-answer contract', async () => {
  const contract = {
    anchors: [{ anchorId: 'a1', sourceRef: 'doc://platform/worker-design.md#retry' }],
    evidence: [{ evidenceId: 'e1', anchorRefs: ['a1'], score: 0.94, snippet: 'exponential backoff with jitter' }],
  }
  const fetchImpl: Fetchish = async () => ({ ok: true, status: 200, json: async () => contract })
  const r = await searchPlatform('retry', 'http://sherlock', fetchImpl)
  assert.equal(r.ok, true)
  assert.equal(r.hits[0].source, 'platform')
  assert.equal(r.hits[0].ref, 'a1')
  assert.equal(r.hits[0].title, 'doc://platform/worker-design.md#retry')
  assert.match(r.hits[0].snippet, /exponential backoff/)
})

test('search(all) unions local + platform independently', async () => {
  const gw = await mockLampstand({ result: { hits: [{ path: '/a', snippet: 's', score: 1 }] } })
  const fetchImpl: Fetchish = async () => ({ ok: true, status: 200, json: async () => ({ anchors: [], evidence: [{ evidenceId: 'e', anchorRefs: [], score: 0.5, snippet: 'p' }] }) })
  try {
    const r = await search('q', 'all', { localSocket: gw.socketPath, platformUrl: 'http://sherlock', fetchImpl })
    assert.equal(r.local.hits.length, 1)
    assert.equal(r.platform.hits.length, 1)
  } finally { gw.close() }
})

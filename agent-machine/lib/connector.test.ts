import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runConnector, manualConnector, functionConnector, type AuthorizeEgress } from './connector.js'

test('manual (local) connector runs and emits an ok receipt with a content hash', async () => {
  const { receipt, docs } = await runConnector(manualConnector('m1', [{ text: 'lead exceeded the action level' }, { text: 'mitigation: filtration' }]))
  assert.equal(receipt.status, 'ok')
  assert.equal(receipt.authorized, true)
  assert.equal(receipt.egress, false)
  assert.equal(receipt.docCount, 2)
  assert.equal(docs.length, 2)
  assert.match(receipt.contentHash, /^[0-9a-f]{64}$/)
  assert.ok(docs[0]!.fetchedAt)
})

test('egress is fail-closed by default — a network connector is DENIED with evidence', async () => {
  const net = functionConnector('gh1', 'github', true, async () => [{ uri: 'gh://x', title: 'x', text: 'y' }])
  const { receipt, docs } = await runConnector(net)
  assert.equal(receipt.status, 'denied')
  assert.equal(receipt.authorized, false)
  assert.equal(docs.length, 0)
  assert.match(receipt.reason ?? '', /egress not authorized/)
})

test('egress is allowed when an authorize hook (scope-d policy) approves', async () => {
  const authorize: AuthorizeEgress = (s) => s.kind === 'github' ? { allowed: true, scope: 'INSTITUTION' } : { allowed: false }
  const net = functionConnector('gh1', 'github', true, async () => [{ uri: 'gh://repo/readme', title: 'README', text: 'project docs' }])
  const { receipt, docs } = await runConnector(net, { authorize })
  assert.equal(receipt.status, 'ok')
  assert.equal(receipt.authorized, true)
  assert.equal(receipt.scope, 'INSTITUTION')
  assert.equal(docs.length, 1)
})

test('a fetch failure is captured as an error receipt, never thrown', async () => {
  const broken = functionConnector('b1', 'web', true, async () => { throw new Error('connection refused') })
  const { receipt, docs } = await runConnector(broken, { authorize: () => ({ allowed: true }) })
  assert.equal(receipt.status, 'error')
  assert.equal(docs.length, 0)
  assert.match(receipt.reason ?? '', /connection refused/)
})

test('content hash is deterministic for the same docs and changes when content changes', async () => {
  const a = await runConnector(manualConnector('m', [{ uri: 'u', text: 'same' }]), { now: () => 'T' })
  const b = await runConnector(manualConnector('m', [{ uri: 'u', text: 'same' }]), { now: () => 'T' })
  const c = await runConnector(manualConnector('m', [{ uri: 'u', text: 'different' }]), { now: () => 'T' })
  assert.equal(a.receipt.contentHash, b.receipt.contentHash)
  assert.notEqual(a.receipt.contentHash, c.receipt.contentHash)
})

test('onReceipt hook forwards the receipt to the evidence fabric (every run, incl. denials)', async () => {
  const seen: string[] = []
  await runConnector(manualConnector('ok', [{ text: 'x' }]), { onReceipt: (r) => seen.push(r.status) })
  await runConnector(functionConnector('deny', 'web', true, async () => []), { onReceipt: (r) => seen.push(r.status) })
  assert.deepEqual(seen, ['ok', 'denied'])
})

test('manual connector drops empty docs and assigns uris/titles', async () => {
  const { docs } = await runConnector(manualConnector('m', [{ text: 'real' }, { text: '   ' }, { text: '' }]))
  assert.equal(docs.length, 1)
  assert.match(docs[0]!.uri, /^manual:\/\/m\//)
})

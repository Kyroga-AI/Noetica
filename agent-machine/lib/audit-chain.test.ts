import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonical, hashRecord, buildChain, verifyChain, chainHead, GENESIS,
  generateAuditKeypair, signHead, verifyHead, type AuditRecord,
} from './audit-chain.js'

const runs: AuditRecord[] = [
  { run_id: 'r1', provider: 'ollama', tokens_egressed: 0, ts: '2026-06-21T10:00:00Z' },
  { run_id: 'r2', provider: 'anthropic', tokens_egressed: 1200, ts: '2026-06-21T11:00:00Z' },
  { run_id: 'r3', provider: 'ollama', tokens_egressed: 0, ts: '2026-06-21T12:00:00Z' },
]

test('canonical is key-order independent', () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }))
  assert.equal(canonical({ x: { p: 1, q: 2 } }), canonical({ x: { q: 2, p: 1 } }))
})

test('chain is genesis-anchored and links each record to its predecessor', () => {
  const chain = buildChain(runs)
  assert.equal(chain.length, 3)
  assert.equal(chain[0]!.prevHash, GENESIS)
  assert.equal(chain[1]!.prevHash, chain[0]!.hash)
  assert.equal(chain[2]!.prevHash, chain[1]!.hash)
})

test('verify: intact chain is valid', () => {
  const chain = buildChain(runs)
  const v = verifyChain(runs, chain)
  assert.equal(v.valid, true)
  assert.equal(v.brokenAt, null)
  assert.equal(v.head, chainHead(chain))
})

test('verify: EDITING a record breaks the chain at that index', () => {
  const chain = buildChain(runs)
  const tampered = runs.map((r, i) => (i === 1 ? { ...r, tokens_egressed: 0 } : r)) // hide the egress!
  const v = verifyChain(tampered, chain)
  assert.equal(v.valid, false)
  assert.equal(v.brokenAt, 1)
})

test('verify: DELETING a record is detected', () => {
  const chain = buildChain(runs)
  const v = verifyChain([runs[0]!, runs[2]!], chain)
  assert.equal(v.valid, false)
})

test('verify: INSERTING a record is detected', () => {
  const chain = buildChain(runs)
  const v = verifyChain([runs[0]!, { run_id: 'rX', provider: 'openai' }, runs[1]!, runs[2]!], chain)
  assert.equal(v.valid, false)
  assert.equal(v.brokenAt, 1)
})

test('Ed25519: device-signed head verifies; tampered head or wrong key fails', () => {
  const { publicKey, privateKey } = generateAuditKeypair()
  const head = chainHead(buildChain(runs))
  const sig = signHead(head, privateKey)
  assert.equal(verifyHead(head, sig, publicKey), true)
  // tamper the head → signature no longer matches
  const badHead = head.slice(0, -1) + (head.endsWith('a') ? 'b' : 'a')
  assert.equal(verifyHead(badHead, sig, publicKey), false)
  // a different device key cannot have produced this signature
  const other = generateAuditKeypair()
  assert.equal(verifyHead(head, sig, other.publicKey), false)
})

test('verifyHead is throw-safe on garbage signature', () => {
  const { publicKey } = generateAuditKeypair()
  assert.equal(verifyHead('deadbeef', 'not-base64-!!!', publicKey), false)
})

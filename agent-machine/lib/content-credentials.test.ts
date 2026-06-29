/**
 * content-credentials.test.ts — EU AI Act Art.50 C2PA marking unit tests.
 * Covers: credential shape, deterministic digest, idempotent text marking,
 * response hash, compliance log entry structure, and SSE event payload.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeCredential,
  manifestDigest,
  markAIGenerated,
  responseHash,
  logAIActEvent,
  buildC2PAEventPayload,
  type ContentCredential,
  type ComplianceLogEntry,
} from './content-credentials.js'

// ── makeCredential ────────────────────────────────────────────────────────────

test('content-credentials: makeCredential returns correct shape', () => {
  const cred = makeCredential({ model: 'qwen3:14b', timestamp: '2026-06-29T00:00:00.000Z' })
  assert.equal(cred.generator, 'noetica')
  assert.equal(cred.model, 'qwen3:14b')
  assert.equal(cred.aiGenerated, true)
  assert.equal(cred.timestamp, '2026-06-29T00:00:00.000Z')
  assert.deepEqual(cred.sourceRefs, [])
})

test('content-credentials: makeCredential accepts custom generator and sourceRefs', () => {
  const cred = makeCredential({ generator: 'my-app', model: 'claude-3', timestamp: '2026-01-01T00:00:00.000Z', sourceRefs: ['doc-1', 'doc-2'] })
  assert.equal(cred.generator, 'my-app')
  assert.deepEqual(cred.sourceRefs, ['doc-1', 'doc-2'])
})

// ── manifestDigest ────────────────────────────────────────────────────────────

test('content-credentials: manifestDigest is deterministic', () => {
  const opts = { model: 'qwen3:14b', timestamp: '2026-06-29T12:00:00.000Z', sourceRefs: ['ref-a'] }
  const a = manifestDigest(makeCredential(opts))
  const b = manifestDigest(makeCredential(opts))
  assert.equal(a, b, 'digest must be identical for identical inputs')
  assert.ok(a.startsWith('cc_'), 'digest must start with cc_ prefix')
  assert.equal(a.length, 11, 'cc_ + 8 hex chars = 11')
})

test('content-credentials: manifestDigest is sensitive to model change', () => {
  const base = { timestamp: '2026-06-29T12:00:00.000Z' }
  const d1 = manifestDigest(makeCredential({ ...base, model: 'model-a' }))
  const d2 = manifestDigest(makeCredential({ ...base, model: 'model-b' }))
  assert.notEqual(d1, d2, 'different models must produce different digests')
})

test('content-credentials: manifestDigest sourceRefs order-insensitive', () => {
  const ts = '2026-06-29T00:00:00.000Z'
  const m = 'qwen3:14b'
  const d1 = manifestDigest(makeCredential({ model: m, timestamp: ts, sourceRefs: ['b', 'a'] }))
  const d2 = manifestDigest(makeCredential({ model: m, timestamp: ts, sourceRefs: ['a', 'b'] }))
  assert.equal(d1, d2, 'sourceRefs are sorted before hashing — order should not matter')
})

// ── markAIGenerated ───────────────────────────────────────────────────────────

test('content-credentials: markAIGenerated appends C2PA marker', () => {
  const cred = makeCredential({ model: 'test-model', timestamp: '2026-06-29T00:00:00.000Z' })
  const marked = markAIGenerated('Hello world', cred)
  assert.ok(marked.includes('c2pa:ai-generated'), 'must contain c2pa:ai-generated')
  assert.ok(marked.includes(`model="${cred.model}"`), 'must include model name')
  assert.ok(marked.includes(`digest="cc_`), 'must include digest')
  assert.ok(marked.startsWith('Hello world'), 'original text must be preserved')
})

test('content-credentials: markAIGenerated is idempotent', () => {
  const cred = makeCredential({ model: 'test-model', timestamp: '2026-06-29T00:00:00.000Z' })
  const once = markAIGenerated('Hello', cred)
  const twice = markAIGenerated(once, cred)
  assert.equal(once, twice, 'double-marking must not append a second marker')
})

// ── responseHash ──────────────────────────────────────────────────────────────

test('content-credentials: responseHash produces sha256: prefixed hex', () => {
  const h = responseHash('some AI-generated text')
  assert.ok(h.startsWith('sha256:'), 'must be sha256 prefixed')
  assert.equal(h.length, 7 + 64, 'sha256: + 64 hex chars')
})

test('content-credentials: responseHash is deterministic and collision-sensitive', () => {
  assert.equal(responseHash('abc'), responseHash('abc'), 'same input → same hash')
  assert.notEqual(responseHash('abc'), responseHash('abcd'), 'different input → different hash')
})

// ── logAIActEvent ─────────────────────────────────────────────────────────────

test('content-credentials: logAIActEvent returns correct compliance entry shape', () => {
  const cred = makeCredential({ model: 'noetica-local', timestamp: '2026-06-29T10:00:00.000Z' })
  // Pass logsDir: null to skip actual file write in tests
  const entry: ComplianceLogEntry = logAIActEvent({ responseText: 'AI response text', cred, logsDir: null })

  assert.equal(entry.event, 'ai_generated_response')
  assert.equal(entry.complianceStandard, 'EU-AI-Act-Art50')
  assert.equal(entry.model, 'noetica-local')
  assert.equal(entry.generator, 'noetica')
  assert.ok(entry.responseHash.startsWith('sha256:'), 'responseHash must be sha256 prefixed')
  assert.ok(entry.digest.startsWith('cc_'), 'digest must be cc_ prefixed')
  assert.ok(typeof entry.timestamp === 'string' && entry.timestamp.length > 0, 'timestamp must be non-empty')
  assert.ok(typeof entry.markedAt === 'string' && entry.markedAt.length > 0, 'markedAt must be non-empty')
})

test('content-credentials: logAIActEvent never includes raw response text', () => {
  const cred = makeCredential({ model: 'test', timestamp: '2026-06-29T00:00:00.000Z' })
  const secretText = 'SUPERSECRET-CONTENT-MUST-NOT-APPEAR'
  const entry = logAIActEvent({ responseText: secretText, cred, logsDir: null })
  const serialized = JSON.stringify(entry)
  assert.ok(!serialized.includes(secretText), 'raw response text must NEVER appear in the log entry')
})

// ── buildC2PAEventPayload ─────────────────────────────────────────────────────

test('content-credentials: buildC2PAEventPayload returns correct SSE event shape', () => {
  const cred = makeCredential({ model: 'qwen3:14b', timestamp: '2026-06-29T00:00:00.000Z' })
  const payload = buildC2PAEventPayload(cred)

  assert.equal(payload.standard, 'EU-AI-Act-Art50')
  assert.equal(payload.generator, 'noetica')
  assert.equal(payload.model, 'qwen3:14b')
  assert.equal(payload.aiGenerated, true)
  assert.ok(payload.digest.startsWith('cc_'), 'digest must be cc_ prefixed')
  assert.equal(payload.timestamp, '2026-06-29T00:00:00.000Z')
})

test('content-credentials: buildC2PAEventPayload digest matches manifestDigest', () => {
  const cred = makeCredential({ model: 'qwen3:14b', timestamp: '2026-06-29T00:00:00.000Z', sourceRefs: ['s1'] })
  const payload = buildC2PAEventPayload(cred)
  assert.equal(payload.digest, manifestDigest(cred), 'event payload digest must match direct manifestDigest call')
})

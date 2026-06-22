/** Tests for the new-hope / sherlock-search / slash-topics conformance bridges. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { membraneEvent, outcomeFor, conformsToMembrane } from './new-hope-membrane.js'
import { buildEvidenceAnswer, conformsToEvidenceAnswer } from './sherlock-evidence.js'
import { applyScope, packDigest, conformsToTopicPack } from './slash-topic-scope.js'

test('new-hope: trust decision maps to membrane outcome; event is conformant', () => {
  assert.deepEqual(outcomeFor({ trust: 'untrusted', injected: true }), { membraneOutcome: 'deny', policyDecision: 'deny' })
  assert.deepEqual(outcomeFor({ trust: 'untrusted' }), { membraneOutcome: 'quarantine', policyDecision: 'review' })
  assert.deepEqual(outcomeFor({ trust: 'trusted' }), { membraneOutcome: 'admit', policyDecision: 'allow' })
  const e = membraneEvent({ carrierRef: 'web:doc1', message: 'ingest', emittedAt: 'T', decision: { trust: 'untrusted', injected: true } })
  assert.equal(e.membraneOutcome, 'deny')
  assert.equal(conformsToMembrane(e).conforms, true)
})

test('sherlock: retrieval → Anchor→Normalize→Propose evidence answer (ranked + handoff boundary)', () => {
  const a = buildEvidenceAnswer({
    query: 'who runs model routing',
    anchors: [{ id: 'mr', label: 'model-router', kind: 'feature' }],
    evidence: [{ sourceRef: 'doc2', text: 'b', score: 0.3 }, { sourceRef: 'doc1', text: 'a', score: 0.9 }],
    proposedClaims: [{ subject: 'model-router', predicate: 'routes', object: 'models', support: 0.8 }],
  })
  assert.equal(a.segment, 'anchor->normalize->propose')
  assert.equal(a.evidence[0]!.sourceRef, 'doc1', 'normalized = ranked by score')
  assert.equal(a.handoff.verify, 'holmes', 'Verify handed off (not owned)')
  assert.equal(conformsToEvidenceAnswer(a).conforms, true)
})

test('slash-topics: /topic scope filters retrieval + emits a deterministic replay receipt', () => {
  const pack = { topic: '/security', version: '1', include: ['auth', 'guardrail'], exclude: ['recipe'] }
  const scoped = applyScope([{ text: 'auth flow' }, { text: 'cooking recipe' }, { text: 'guardrail policy' }], pack)
  assert.equal(scoped.kept.length, 2)
  assert.equal(scoped.dropped, 1)
  assert.equal(scoped.receipt.keptCount, 2)
  assert.equal(packDigest(pack), packDigest({ ...pack, include: ['guardrail', 'auth'] }), 'digest is order-independent')
  assert.equal(conformsToTopicPack(pack).conforms, true)
  assert.equal(conformsToTopicPack({ topic: 'security', version: '1', include: [] }).conforms, false, 'topic must start with /')
})

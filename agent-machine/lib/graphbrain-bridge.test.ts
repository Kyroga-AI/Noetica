import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTopicRefs, buildDomainShape, consumeLatentArtifact, matchDomains, type LatentBasisArtifact } from './graphbrain-bridge.js'

// Real shape from graphbrain-contract artifacts/latent-22-lda-derived-9fad080c58b4.json
const REAL_REFS = [
  'topic:rte:ml knowledge,planning,abstract,graph,networks mathematics',
  'topic:pol:agents,agents planning,ml agents,planning,ml',
  'topic:trt:2019,symbolic,international,reasoning,neural',
]

test('parseTopicRefs handles multi-word, comma-delimited terms', () => {
  const topics = parseTopicRefs(REAL_REFS)
  assert.equal(topics.length, 3)
  assert.equal(topics[0]!.code, 'rte')
  assert.deepEqual(topics[0]!.terms, ['ml knowledge', 'planning', 'abstract', 'graph', 'networks mathematics'])
  assert.equal(topics[2]!.terms.includes('symbolic'), true)
})

test('parseTopicRefs tolerates empty term lists (unlabeled LSA components)', () => {
  const topics = parseTopicRefs(['topic:rte:', 'topic:pol:'])
  assert.equal(topics.length, 2)
  assert.deepEqual(topics[0]!.terms, [])
})

test('buildDomainShape encodes the closed-basis law (exactly N topics)', () => {
  const shape = buildDomainShape('domain:corpus-x', 22) as any
  const topicConstraint = shape['sh:property'].find((p: any) => p['sh:path'] === 'HAS_TOPIC')
  assert.equal(topicConstraint['sh:minCount'], 22)
  assert.equal(topicConstraint['sh:maxCount'], 22)
})

test('consumeLatentArtifact mints Domain + Topics + GlossaryTerms + shape, idempotently', () => {
  const artifact: LatentBasisArtifact = {
    artifact_id: 'latent-22-lda-derived-TEST',
    corpus_release_ref: 'corpus-test-' + Date.now(),
    basis_family: 'lda-derived',
    dimension_count: 3,
    topic_representation_refs: REAL_REFS,
    training_lineage: { run_id: 'run-test', n_documents: 97 },
  }
  const first = consumeLatentArtifact(artifact)
  assert.equal(first.alreadyPresent, false)
  assert.equal(first.topics, 3)
  // 'planning' appears in both rte and pol -> deduped to one GlossaryTerm
  assert.equal(first.glossaryTerms < 15, true, 'terms are deduped across topics')
  assert.ok(first.glossaryTerms >= 10)
  assert.equal(first.shapeId, first.domainId + '#shape')

  // Re-consume: idempotent no-op
  const second = consumeLatentArtifact(artifact)
  assert.equal(second.alreadyPresent, true)
  assert.equal(second.topics, 3)

  // matchDomains: a query mentioning glossary vocabulary finds the domain + topics.
  // HellGraph persists across runs, so use a wide topK to locate this run's domain
  // among any other consumed domains in the shared graph.
  const matches = matchDomains('how do agents do planning over a knowledge graph', 50)
  const hit = matches.find((m) => m.domainId === first.domainId)
  assert.ok(hit, 'query routed to the domain via glossary overlap')
  assert.ok(hit!.topics.length >= 1, 'matched at least one topic')
  assert.ok(hit!.matchedTerms.includes('planning'), 'surfaced the matched glossary term')
})

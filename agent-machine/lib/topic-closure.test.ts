import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clusterByLexicalClosure, consonantSkeleton, coreTokens } from './topic-closure.js'

test('consonantSkeleton collapses noetica / notca / ntca to the same skeleton', () => {
  assert.equal(consonantSkeleton('noetica'), 'ntc')
  assert.equal(consonantSkeleton('notca'), 'ntc')
  assert.equal(consonantSkeleton('ntca'), 'ntc')
  // distinct topics get distinct skeletons
  assert.notEqual(consonantSkeleton('ollama'), 'ntc')
  assert.notEqual(consonantSkeleton('retrvl'), 'ntc')
})

test('coreTokens drops separators + stopwords (self/tmp/probe)', () => {
  assert.deepEqual(coreTokens('self notca md'), ['notca'])
  assert.deepEqual(coreTokens('/tmp/ntca prbe'), ['ntca'])
  assert.deepEqual(coreTokens('noetica_probe'), ['noetica'])
})

test('the fragmented noetica family collapses into ONE cluster, canonical "noetica"', () => {
  const labels = ['noetica', 'notca', 'ntca', 'noetica_probe', 'noetica-works', 'self notca md', '/tmp/ntca prbe', 'self/ntca']
  const { clusters, canonicalOf } = clusterByLexicalClosure(labels)
  // every noetica-ish label shares one cluster id
  const canon = canonicalOf.get('noetica')
  assert.equal(canon, 'noetica')
  for (const l of labels) assert.equal(canonicalOf.get(l), 'noetica', `${l} should map to noetica`)
  // they form a single cluster (not 8 singletons)
  const noeticaCluster = clusters.find((c) => c.includes('noetica'))!
  assert.equal(noeticaCluster.length, labels.length)
})

test('unrelated topics stay in their own clusters (no over-merge)', () => {
  const labels = ['noetica', 'notca', 'ollama', 'hellgrph', 'retrvl', 'bash', 'npm instll', 'CFsrTxtncdng']
  const { canonicalOf } = clusterByLexicalClosure(labels)
  const noetica = canonicalOf.get('noetica')
  assert.equal(canonicalOf.get('notca'), noetica)
  for (const other of ['ollama', 'hellgrph', 'retrvl', 'bash', 'CFsrTxtncdng']) {
    assert.notEqual(canonicalOf.get(other), noetica, `${other} must NOT merge into the noetica topic`)
  }
})

test('plain typos cluster via edit distance', () => {
  const { canonicalOf } = clusterByLexicalClosure(['retrieval', 'retreival', 'ollama'])
  assert.equal(canonicalOf.get('retrieval'), canonicalOf.get('retreival'))
  assert.notEqual(canonicalOf.get('ollama'), canonicalOf.get('retrieval'))
})

test('singletons are their own cluster', () => {
  const { clusters } = clusterByLexicalClosure(['alpha', 'beta', 'gamma'])
  assert.equal(clusters.length, 3)
})

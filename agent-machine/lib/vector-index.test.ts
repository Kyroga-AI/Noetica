/** Tests for the vector index + graph-vector hybrid query (the #1 graph-DB gap shim). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VectorIndex, hybridGraphVector } from './vector-index.js'

test('VectorIndex: cosine kNN ranks nearest, excludes self, dedupes ids', () => {
  const idx = new VectorIndex()
  idx.addMany([{ id: 'a', vec: [1, 0, 0] }, { id: 'b', vec: [0.9, 0.1, 0] }, { id: 'z', vec: [0, 0, 1] }])
  idx.add('a', [1, 0, 0])   // re-add same id → no dup
  assert.equal(idx.size(), 3)
  const r = idx.search([1, 0, 0], 2, 'a')
  assert.equal(r[0]!.id, 'b', 'nearest non-self is b')
  assert.equal(r.some((x) => x.id === 'a'), false, 'self excluded')
  assert.ok(r[0]!.score > r[1]!.score)
})

test('hybridGraphVector: vector entry points then graph expansion with hop distance', () => {
  const idx = new VectorIndex()
  idx.addMany([{ id: 'entry', vec: [1, 0, 0] }, { id: 'far', vec: [0, 0, 1] }])
  const adj = new Map<string, string[]>([['entry', ['n1', 'n2']], ['n1', ['n3']]])
  const out = hybridGraphVector([1, 0, 0], idx, adj, { k: 1, hops: 2 })
  const ids = out.map((o) => o.id)
  assert.equal(out.find((o) => o.id === 'entry')!.hop, 0, 'vector match is hop 0')
  assert.ok(ids.includes('n1') && ids.includes('n2'), 'hop-1 neighbours included')
  assert.equal(out.find((o) => o.id === 'n3')!.hop, 2, 'hop-2 neighbour reached')
  assert.equal(ids.includes('far'), false, 'unrelated vector not pulled in')
})

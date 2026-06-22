/** Tests for query-seeded Personalized PageRank (HippoRAG associative retrieval). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { personalizedPageRank, seedFromQuery, associativeRetrieve } from './graph-ppr.js'

// Two clusters joined by a bridge: {A,B,C} — D — {E,F,G}
const nodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => ({ id }))
const edges = [
  { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' },
  { from: 'C', to: 'D' }, { from: 'D', to: 'E' },
  { from: 'E', to: 'F' }, { from: 'F', to: 'G' }, { from: 'G', to: 'E' },
]

test('PPR concentrates rank near the seed, not uniformly', () => {
  const ranks = personalizedPageRank(nodes, edges, ['A'])
  // A's own cluster should outrank the far cluster
  assert.equal(ranks.get('B')! > ranks.get('F')!, true, "seed A's neighbour B beats distant F")
  assert.equal(ranks.get('C')! > ranks.get('G')!, true)
  // total mass ≈ 1 (it's a distribution)
  const total = [...ranks.values()].reduce((s, x) => s + x, 0)
  assert.ok(Math.abs(total - 1) < 1e-3, 'PPR is a probability distribution')
})

test('different seeds produce different rankings (query-conditioned)', () => {
  const fromA = personalizedPageRank(nodes, edges, ['A'])
  const fromG = personalizedPageRank(nodes, edges, ['G'])
  assert.equal(fromA.get('B')! > fromG.get('B')!, true, 'B ranks higher when seeded from its own cluster')
  assert.equal(fromG.get('F')! > fromA.get('F')!, true, 'F ranks higher when seeded from G')
})

test('no resolvable seed falls back to uniform teleport (plain PageRank)', () => {
  const ranks = personalizedPageRank(nodes, edges, ['NONEXISTENT'])
  // with uniform teleport, the bridge node D (high betweenness) should rank well, not collapse to one cluster
  assert.ok(ranks.get('D')! > 0)
  const total = [...ranks.values()].reduce((s, x) => s + x, 0)
  assert.ok(Math.abs(total - 1) < 1e-3)
})

test('seedFromQuery matches labels (exact preferred over partial)', () => {
  const labels = new Map([['n1', 'model router'], ['n2', 'database'], ['n3', 'routing']])
  assert.deepEqual(seedFromQuery('how does the model router work', labels), ['n1'], 'whole label present → exact seed')
  // no whole-label match, but a query term is contained in a multi-word label → partial
  const partial = seedFromQuery('router configuration guide', labels)
  assert.deepEqual(partial, ['n1'], "'router' is inside the label 'model router' → partial seed")
})

test('associativeRetrieve returns seeds + ranked non-seed results', () => {
  const labels = new Map(nodes.map((n) => [n.id, n.id]))
  const { seeds, results } = associativeRetrieve(nodes, edges, labels, 'A', { topK: 3 })
  assert.deepEqual(seeds, ['A'])
  assert.equal(results.find((r) => r.id === 'A'), undefined, 'seed excluded from results by default')
  assert.equal(results.length, 3)
  assert.equal(results[0]!.score >= results[1]!.score, true, 'sorted by score')
})

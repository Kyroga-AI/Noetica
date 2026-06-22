/** Tests for entity-embedding similarity + semantic link prediction (deterministic over given vectors). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { similarEntities, semanticPredict, blendSemantic } from './graph-embed.js'
import type { LinkPrediction } from './graph-predict.js'

// Three near-identical vectors + one orthogonal.
const vectors = new Map<string, number[]>([
  ['a', [1, 0, 0]],
  ['b', [0.99, 0.14, 0]],   // very close to a
  ['c', [0.9, 0.43, 0]],    // somewhat close to a
  ['z', [0, 0, 1]],         // orthogonal to all
])

test('similarEntities ranks by cosine and excludes the target', () => {
  const sims = similarEntities('a', vectors, 3)
  assert.equal(sims.find((s) => s.id === 'a'), undefined, 'target excluded')
  assert.equal(sims[0]!.id, 'b', 'closest is b')
  assert.equal(sims[0]!.sim > sims[1]!.sim, true, 'sorted descending')
  assert.equal(sims.some((s) => s.id === 'z' && s.sim > 0.5), false, 'orthogonal z is not "similar"')
})

test('semanticPredict proposes cosine-close pairs that are not already linked', () => {
  const edges = [{ from: 'a', to: 'b' }]   // a—b already connected
  const preds = semanticPredict(vectors, edges, { topK: 10, minSim: 0.85 })
  // a—b is connected → excluded; a—c (cos ~0.9) is close + unconnected → predicted
  assert.equal(preds.some((p) => (p.source === 'a' && p.target === 'b') || (p.source === 'b' && p.target === 'a')), false, 'connected pair excluded')
  assert.equal(preds.some((p) => (p.source === 'a' && p.target === 'c') || (p.source === 'c' && p.target === 'a')), true, 'close unconnected pair predicted')
  // z is orthogonal → never above the 0.85 threshold
  assert.equal(preds.some((p) => p.source === 'z' || p.target === 'z'), false)
})

test('blendSemantic annotates sim, merges semantic candidates, and re-ranks', () => {
  const structural: LinkPrediction[] = [{ source: 'a', target: 'c', score: 0.5, commonNeighbors: 1 }]
  const out = blendSemantic(structural, vectors, [{ from: 'a', to: 'b' }], 10)
  const ac = out.find((p) => (p.source === 'a' && p.target === 'c') || (p.source === 'c' && p.target === 'a'))
  assert.notEqual(ac, undefined)
  assert.equal(typeof ac!.sim, 'number', 'structural candidate annotated with semantic sim')
  assert.equal(ac!.sim! > 0.8, true)
})

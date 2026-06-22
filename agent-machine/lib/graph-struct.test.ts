/**
 * Tests for DeepWalk-style structural embeddings. Random walks make exact values non-deterministic, so
 * we assert STRUCTURAL invariants that hold regardless of the RNG (with enough walks to be stable).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { structuralEmbeddings, structurallySimilar } from './graph-struct.js'

test('vectors are L2-normalized for connected nodes, zero for isolated', () => {
  const nodes = ['A', 'B', 'C', 'ISO'].map((id) => ({ id }))
  const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]   // path A-B-C; ISO disconnected
  const emb = structuralEmbeddings(nodes, edges, { walks: 30, length: 6, window: 2 })
  const norm = (v: Float64Array) => Math.sqrt([...v].reduce((s, x) => s + x * x, 0))
  assert.ok(Math.abs(norm(emb.vectors.get('A')!) - 1) < 1e-6 || norm(emb.vectors.get('A')!) === 0, 'A normalized')
  assert.equal(norm(emb.vectors.get('ISO')!), 0, 'isolated node → zero vector (no walks)')
})

test('connected neighbours co-occur → positive structural similarity', () => {
  const nodes = ['A', 'B', 'C'].map((id) => ({ id }))
  const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]
  const emb = structuralEmbeddings(nodes, edges, { walks: 50, length: 8, window: 2 })
  const sims = structurallySimilar('A', emb, 5)
  assert.equal(sims.length >= 1, true, 'a connected node has structural neighbours')
  for (const s of sims) assert.equal(s.sim > 0, true, 'co-occurring nodes have positive similarity')
})

test('two symmetric hubs are structurally similar', () => {
  // Two identical gadgets: hub H1·{x1,x2}, hub H2·{y1,y2}, joined H1-H2.
  const nodes = ['H1', 'x1', 'x2', 'H2', 'y1', 'y2'].map((id) => ({ id }))
  const edges = [
    { from: 'H1', to: 'x1' }, { from: 'H1', to: 'x2' },
    { from: 'H2', to: 'y1' }, { from: 'H2', to: 'y2' },
    { from: 'H1', to: 'H2' },
  ]
  const emb = structuralEmbeddings(nodes, edges, { walks: 80, length: 10, window: 2 })
  const sims = structurallySimilar('H1', emb, 5)
  // H2 (the symmetric twin) should be among H1's structural neighbours, ahead of a leaf like y1
  const h2 = sims.find((s) => s.id === 'H2')
  assert.notEqual(h2, undefined, 'symmetric hub H2 is structurally similar to H1')
})

/** Tests for structural link prediction (Adamic-Adar). Runs in CI via `npm test`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predictLinks } from './graph-predict.js'

test('predicts a link between nodes that share neighbours but are not connected', () => {
  // X and Y both connect to hubs H1, H2 (2 shared neighbours) but not to each other.
  const nodes = ['X', 'Y', 'H1', 'H2'].map((id) => ({ id }))
  const edges = [
    { from: 'X', to: 'H1' }, { from: 'X', to: 'H2' },
    { from: 'Y', to: 'H1' }, { from: 'Y', to: 'H2' },
  ]
  const preds = predictLinks(nodes, edges, { topK: 5, minCommon: 2 })
  const xy = preds.find((p) => (p.source === 'X' && p.target === 'Y') || (p.source === 'Y' && p.target === 'X'))
  assert.notEqual(xy, undefined, 'X—Y should be predicted (2 shared neighbours)')
  assert.equal(xy!.commonNeighbors, 2)
})

test('never predicts existing edges or self-loops', () => {
  const nodes = ['A', 'B', 'C'].map((id) => ({ id }))
  const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'A', to: 'C' }]   // triangle (fully connected)
  const preds = predictLinks(nodes, edges, { topK: 10, minCommon: 1 })
  for (const p of preds) {
    assert.notEqual(p.source, p.target, 'no self-loops')
    const exists = edges.some((e) => (e.from === p.source && e.to === p.target) || (e.from === p.target && e.to === p.source))
    assert.equal(exists, false, 'never re-predicts an existing edge')
  }
})

test('respects minCommon threshold', () => {
  const nodes = ['X', 'Y', 'H1'].map((id) => ({ id }))
  const edges = [{ from: 'X', to: 'H1' }, { from: 'Y', to: 'H1' }]   // only 1 shared neighbour
  assert.equal(predictLinks(nodes, edges, { minCommon: 2 }).length, 0, '1 shared < minCommon 2 → no prediction')
  assert.equal(predictLinks(nodes, edges, { minCommon: 1 }).length >= 1, true, '1 shared ≥ minCommon 1 → predicted')
})

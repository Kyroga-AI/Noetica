/** Tests for the OpenCog values layer — PLN truth, ECAN attention, truth-weighted PageRank. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stv, deduction, revision, expectation, stimulate, decay, spreadAttention, stiNorm, weightedPageRank } from './opencog-values.js'

test('PLN deduction multiplies strength + confidence (chained belief weakens)', () => {
  const d = deduction(stv(0.9, 0.8), stv(0.8, 0.7))
  assert.ok(Math.abs(d.strength - 0.72) < 1e-9)
  assert.ok(Math.abs(d.confidence - 0.56) < 1e-9)
  assert.ok(d.confidence < 0.8, 'a derived fact is less confident than its premises')
})

test('PLN revision merges same-statement estimates, confidence-weighted + accruing', () => {
  const r = revision(stv(0.8, 0.5), stv(0.6, 0.5))
  assert.ok(Math.abs(r.strength - 0.7) < 1e-9, 'equal confidence → average strength')
  assert.ok(r.confidence > 0.5, 'two estimates accrue more confidence than one')
  assert.equal(expectation(stv(0.5, 0.5)), 0.25)
})

test('ECAN: stimulate raises STI, decay lowers it, spread diffuses to neighbours', () => {
  assert.equal(stimulate({ sti: 1, lti: 0 }, 5).sti, 6)
  assert.ok(decay({ sti: 10, lti: 0 }).sti < 10)
  const spread = spreadAttention(new Map([['a', 10], ['b', 0]]), new Map([['a', ['b']]]), 0.5)
  assert.equal(spread.get('a'), 5, 'a gave away half')
  assert.equal(spread.get('b'), 5, 'b received it')
  const norm = stiNorm(new Map([['a', 10], ['b', 5]]))
  assert.equal(norm.get('a'), 1); assert.equal(norm.get('b'), 0.5)
})

test('truth-weighted PageRank demotes low-confidence edges (de-noising)', () => {
  // hub A connects to B (strong belief) and to NOISE (a low-confidence dev/test edge)
  const nodes = ['A', 'B', 'NOISE']
  const ranks = weightedPageRank(nodes, [
    { from: 'A', to: 'B', tv: stv(0.9, 0.9) },
    { from: 'A', to: 'NOISE', tv: stv(0.5, 0.05) },   // barely believed
  ])
  assert.ok(ranks.get('B')! > ranks.get('NOISE')!, 'well-believed B outranks low-confidence NOISE')
})

test('attention-personalized PageRank promotes the salient (high-STI) node', () => {
  const nodes = ['x', 'y', 'z']
  const edges = [{ from: 'x', to: 'y' }, { from: 'y', to: 'z' }]
  const prior = stiNorm(new Map([['z', 10], ['x', 0], ['y', 0]]))   // z is in attentional focus
  const ranks = weightedPageRank(nodes, edges, { prior })
  assert.ok(ranks.get('z')! > ranks.get('x')!, 'the salient node gets ranked up')
})

/** Tests for the memory-bench retrieval benchmark. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runMemoryBench, compareRetrievers, type Retriever, type Probe } from './memory-bench.js'

const PROBES: Probe[] = [
  { query: 'capital of france', relevant: ['m1'] },
  { query: 'speed of light', relevant: ['m2', 'm3'] },
]

test('perfect retriever scores 1.0 across the board', async () => {
  const perfect: Retriever = (q) =>
    q.includes('france') ? ['m1', 'x', 'y'] : ['m2', 'm3', 'z']
  const r = await runMemoryBench(perfect, PROBES, 3)
  assert.equal(r.recallAtK, 1)
  assert.equal(r.mrr, 1)
  assert.ok(Math.abs(r.ndcgAtK - 1) < 1e-9)
})

test('empty retriever scores 0 recall and 0 mrr', async () => {
  const empty: Retriever = () => []
  const r = await runMemoryBench(empty, PROBES, 5)
  assert.equal(r.recallAtK, 0)
  assert.equal(r.mrr, 0)
})

test('rank matters: relevant hit lower down lowers MRR', async () => {
  const top: Retriever = (q) => (q.includes('france') ? ['m1'] : ['m2'])
  const buried: Retriever = (q) => (q.includes('france') ? ['z', 'y', 'm1'] : ['z', 'm2'])
  const rTop = await runMemoryBench(top, PROBES, 5)
  const rBuried = await runMemoryBench(buried, PROBES, 5)
  assert.ok(rTop.mrr > rBuried.mrr, `top mrr ${rTop.mrr} should beat buried ${rBuried.mrr}`)
})

test('precision penalizes padding with irrelevant ids', async () => {
  const tight: Retriever = (q) => (q.includes('france') ? ['m1'] : ['m2', 'm3'])
  const padded: Retriever = (q) => (q.includes('france') ? ['m1', 'x', 'y', 'z', 'w'] : ['m2', 'm3', 'a', 'b', 'c'])
  const rTight = await runMemoryBench(tight, PROBES, 5)
  const rPadded = await runMemoryBench(padded, PROBES, 5)
  assert.ok(rTight.precisionAtK > rPadded.precisionAtK)
  // Recall is unaffected by padding (same relevant items present).
  assert.equal(rTight.recallAtK, rPadded.recallAtK)
})

test('compareRetrievers reports a positive delta when b is better', async () => {
  const weak: Retriever = () => []
  const strong: Retriever = (q) => (q.includes('france') ? ['m1'] : ['m2', 'm3'])
  const { delta } = await compareRetrievers(weak, strong, PROBES, 5)
  assert.ok(delta.recall > 0)
  assert.ok(delta.mrr > 0)
})

test('supports synchronous retrievers', async () => {
  const sync: Retriever = (q) => (q.includes('france') ? ['m1'] : ['m2', 'm3'])
  const r = await runMemoryBench(sync, PROBES, 5)
  assert.equal(r.probes, 2)
  assert.equal(r.recallAtK, 1)
})

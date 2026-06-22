/** Batch 2 — geo investigation + graph reasoning: cells, co-location, geo-anomaly, rule-mining, think-on-graph. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellId, aggregateByCell, kRing } from './geo-cells.js'
import { findColocations } from './colocation.js'
import { emergingHotspots } from './geo-anomaly.js'
import { mineRules } from './rule-mining.js'
import { beamTraverse, type Edge } from './think-on-graph.js'

const DAY = 86_400_000

test('geo-cells: nearby points share a cell, far points do not; kRing size', () => {
  assert.equal(cellId(-74.010, 40.710, 0.01), cellId(-74.012, 40.711, 0.01), 'within resolution → same cell')
  assert.notEqual(cellId(-74.01, 40.71, 0.01), cellId(-73.0, 41.0, 0.01))
  assert.equal(aggregateByCell([{ lon: -74.01, lat: 40.71 }, { lon: -74.011, lat: 40.711 }], 0.01).size, 1)
  assert.equal(kRing(cellId(0, 0, 1), 1).length, 9)
})

test('colocation: two entities in the same cell+window are a meeting; a lone entity is not', () => {
  const t = 1000 * DAY
  const co = findColocations([
    { entity: 'X', lon: -74.01, lat: 40.71, t },
    { entity: 'Y', lon: -74.011, lat: 40.711, t: t + 60_000 },     // same cell, same 15-min window
    { entity: 'Z', lon: 2.35, lat: 48.85, t },                      // far away (Paris) → no meeting
  ], { minMeetings: 1 })
  assert.equal(co.length, 1)
  assert.deepEqual([co[0]!.a, co[0]!.b].sort(), ['X', 'Y'])
  assert.equal(co[0]!.meetings, 1)
})

test('geo-anomaly: a cell with a recent spike over its baseline is emerging', () => {
  const now = 1000 * DAY
  const events = [
    // baseline: 1 event/day for 5 prior days in cell A
    ...[5, 4, 3, 2].map((d) => ({ lon: 10, lat: 10, t: now - d * DAY })),
    // recent spike: 6 events in the last day
    ...Array.from({ length: 6 }, (_, i) => ({ lon: 10, lat: 10, t: now - i * 1000 })),
  ]
  const hot = emergingHotspots(events, { now, windowMs: DAY, res: 0.5, minZ: 1 })
  assert.equal(hot.some((h) => h.trend === 'emerging'), true)
})

test('rule-mining: discovers a transitive-style rule with confidence', () => {
  // worksAt(x, c) ∧ locatedIn(c, city) ⇒ basedIn(x, city) — make it hold for 2 of 2 paths
  const triples = [
    { s: 'alice', p: 'worksAt', o: 'acme' }, { s: 'acme', p: 'locatedIn', o: 'nyc' }, { s: 'alice', p: 'basedIn', o: 'nyc' },
    { s: 'bob', p: 'worksAt', o: 'globex' }, { s: 'globex', p: 'locatedIn', o: 'nyc' }, { s: 'bob', p: 'basedIn', o: 'nyc' },
  ]
  const rules = mineRules(triples, { minConfidence: 0.5, minSupport: 2 })
  const r = rules.find((x) => x.body[0] === 'worksAt' && x.body[1] === 'locatedIn' && x.head === 'basedIn')
  assert.notEqual(r, undefined)
  assert.equal(r!.confidence, 1)
})

test('think-on-graph: beam search reaches a distant relevant node', () => {
  const adj = new Map<string, Edge[]>([
    ['A', [{ to: 'B', rel: 'r' }, { to: 'X', rel: 'r' }]],
    ['B', [{ to: 'C', rel: 'r' }]],
    ['C', [{ to: 'GOAL', rel: 'r' }]],
  ])
  // score paths heading toward GOAL higher
  const paths = beamTraverse(adj, ['A'], (p) => (p.nodes[p.nodes.length - 1] === 'GOAL' ? 10 : p.nodes.length), { beam: 3, depth: 4 })
  assert.equal(paths.some((p) => p.nodes.includes('GOAL')), true)
})

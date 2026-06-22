/** Wave-3 Batch C — geo/investigation: entity-risk, geo-distance, isochrone, movement, pattern-of-life. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entityRiskScore } from './entity-risk.js'
import { haversine, pointInPolygon } from './geo-distance.js'
import { reachableWithin, isFeasibleTrip, type TimedEdge } from './isochrone.js'
import { detectStops } from './movement.js'
import { buildBaseline, deviations } from './pattern-of-life.js'

test('entity-risk: important-but-isolated-with-anomalies scores high + explains', () => {
  const { score, factors } = entityRiskScore({ pagerank: 0.9, betweenness: 0.1, degree: 1, community: -1, anomalyFlags: ['orphaned_artifact', 'critical_dependency_failed'] })
  assert.ok(score > 0.4)
  assert.equal(factors[0]!.contribution >= factors[factors.length - 1]!.contribution, true, 'sorted by contribution')
  assert.ok(entityRiskScore({ pagerank: 0.05, degree: 8, community: 1 }).score < score)
})

test('geo-distance: haversine + point-in-polygon', () => {
  const d = haversine({ lon: -74, lat: 40.7 }, { lon: -73.9, lat: 40.7 })
  assert.ok(d > 8000 && d < 9000, '~8.4km for 0.1° lon at 40°N')
  const square: Array<[number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]]
  assert.equal(pointInPolygon({ lon: 0.5, lat: 0.5 }, square), true)
  assert.equal(pointInPolygon({ lon: 2, lat: 2 }, square), false)
})

test('isochrone: reachability within a time budget + feasibility check', () => {
  const g = new Map<string, TimedEdge[]>([['A', [{ to: 'B', minutes: 10 }, { to: 'C', minutes: 30 }]], ['B', [{ to: 'D', minutes: 10 }]]])
  const reach = reachableWithin(g, 'A', 25)
  assert.deepEqual(reach.map((r) => r.node).sort(), ['B', 'D'], 'C (30min) excluded; D reachable via B at 20min')
  assert.equal(isFeasibleTrip(g, 'A', 'D', 25), true)
  assert.equal(isFeasibleTrip(g, 'A', 'C', 25), false)
})

test('movement: detects a dwell stop, ignores pass-through', () => {
  const t0 = 1_000_000_000
  const stops = detectStops([
    { lon: 0, lat: 0, t: t0 }, { lon: 0.0001, lat: 0.0001, t: t0 + 6 * 60_000 },   // ~stay 6min
    { lon: 1, lat: 1, t: t0 + 7 * 60_000 },                                          // moved far
  ], { maxMeters: 100, minDwellMs: 5 * 60_000 })
  assert.equal(stops.length, 1)
  assert.ok(stops[0]!.durationMs >= 5 * 60_000)
})

test('pattern-of-life: flags new location + off-hours vs baseline', () => {
  const base = buildBaseline([
    { entity: 'X', hour: 9, place: 'office' }, { entity: 'X', hour: 10, place: 'office' }, { entity: 'X', hour: 9, place: 'home' },
  ])
  assert.deepEqual(deviations({ entity: 'X', hour: 9, place: 'office' }, base), [])
  assert.deepEqual(deviations({ entity: 'X', hour: 3, place: 'warehouse' }, base).sort(), ['new-location', 'off-hours'])
})

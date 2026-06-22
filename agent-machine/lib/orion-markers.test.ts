/** Tests for the OrionMapMarker projection — faithful to orion-field-intelligence's v0.1 contract. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placesToMarkers, markerSlug, placeLayerGroup } from './orion-markers.js'

const places = [
  { name: 'Lower Manhattan', lat: 40.71, lon: -74.01, type: 'region' },
  { name: 'Field Depot 7', lat: 34.05, lon: -118.24, type: 'facility' },
  { name: 'Concept Without Coords', lat: null, lon: null, type: 'other' },
]

test('only geocoded places become markers; coordinates are [lon, lat]', () => {
  const m = placesToMarkers(places)
  assert.equal(m.length, 2, 'the coord-less place is dropped')
  const manhattan = m.find((x) => x.title === 'Lower Manhattan')!
  assert.deepEqual(manhattan.coordinates, [-74.01, 40.71], 'GeoJSON order: lon first, then lat')
})

test('marker_id / event_ref match the contract patterns', () => {
  const m = placesToMarkers(places)
  for (const mk of m) {
    assert.match(mk.marker_id, /^orion-marker-[a-z0-9][a-z0-9._-]*$/)
    assert.match(mk.event_ref, /^orion-evt-[a-z0-9][a-z0-9._-]*$/)
    assert.equal(mk.schema_version, '0.1.0')
  }
})

test('honors the OFIF read-only boundary — no actions', () => {
  for (const mk of placesToMarkers(places)) {
    assert.equal(mk.action_enabled, false, 'no scanner/sweep/recon/dispatch action')
    assert.equal(mk.policy_state, 'attribution_required', 'OSM basemap requires ODbL attribution')
    assert.equal(mk.evidence_grade, 'fused.inferred', 'LLM-classified, not a verified source')
  }
})

test('layer_group maps place types into the contract enum', () => {
  assert.equal(placeLayerGroup('facility'), 'facility_asset')
  assert.equal(placeLayerGroup('city'), 'field_report')
  assert.equal(placeLayerGroup('whatever'), 'unknown')
})

test('out-of-range coordinates are rejected', () => {
  const bad = [{ name: 'Bad', lat: 200, lon: 400, type: 'city' }]
  assert.equal(placesToMarkers(bad).length, 0, 'lat>90 / lon>180 dropped')
})

test('severityOf override lifts severity (e.g. from GAIA abandonment signals)', () => {
  const m = placesToMarkers(places, { severityOf: (n) => (n === 'Field Depot 7' ? 'high' : 'info') })
  assert.equal(m.find((x) => x.title === 'Field Depot 7')!.severity, 'high')
  assert.equal(m.find((x) => x.title === 'Lower Manhattan')!.severity, 'info')
})

test('markerSlug produces a contract-valid leading char', () => {
  assert.match(`x-${markerSlug('!!!')}`, /[a-z0-9]/)
  assert.equal(markerSlug('Lower Manhattan!!'), 'lower-manhattan')
})

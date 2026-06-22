/** Tests for the canonical GAIA ontology bridge — conformant JSON-LD + promotion-state mapping. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promotionState, placeToFeatureEntry, mergeToConcordance, entityToCanonical, gaiaDocument, conformsToGaia, GAIA_NS } from './gaia-bridge.js'

test('promotionState maps Noetica verification → GAIA lifecycle', () => {
  assert.equal(promotionState({ rejected: true }), 'Rejected')
  assert.equal(promotionState({ verified: true }), 'Promoted')
  assert.equal(promotionState({ grounded: true }), 'Promoted')
  assert.equal(promotionState({ hasEvidence: true }), 'ReviewRequired')
  assert.equal(promotionState({}), 'EvidenceOnly')
})

test('placeToFeatureEntry emits a conformant gaia:FeatureRegistryEntry', () => {
  const f = placeToFeatureEntry({ name: 'Lower Manhattan', lat: 40.71, lon: -74.01, type: 'region' }, { verified: true })
  assert.equal(f['@type'], 'gaia:FeatureRegistryEntry')
  assert.equal(f['gaia:hasFeatureId'], 'Lower Manhattan')
  assert.equal(f['gaia:hasPromotionState'], 'gaia:Promoted')
  assert.equal(f['gaia:lat'], 40.71)
  assert.equal(conformsToGaia(f).conforms, true, 'satisfies the FeatureRegistryEntry SHACL shape')
})

test('mergeToConcordance emits a gaia:ConcordanceLink with source + canonical', () => {
  const c = mergeToConcordance({ a: 'Noetica Noetica', b: 'noetica', confidence: 0.9 })
  assert.equal(c['@type'], 'gaia:ConcordanceLink')
  assert.equal(c['gaia:hasSourceRecordId'], 'Noetica Noetica')
  assert.equal(String(c['gaia:hasCanonicalEntity']).startsWith('gaia:entity-'), true)
  assert.equal(conformsToGaia(c).conforms, true)
})

test('conformsToGaia flags a record missing required props', () => {
  const bad = { '@id': 'gaia:feature-x', '@type': 'gaia:FeatureRegistryEntry' } as Record<string, unknown> & { '@id': string; '@type': string }
  const r = conformsToGaia(bad)
  assert.equal(r.conforms, false)
  assert.ok(r.missing.includes('gaia:hasFeatureId') && r.missing.includes('gaia:hasPromotionState'))
})

test('gaiaDocument wraps records with the canonical @context (correct namespace)', () => {
  const doc = gaiaDocument([entityToCanonical('model-router', 'Model Router')])
  assert.equal(doc['@context'].gaia, GAIA_NS)
  assert.equal(GAIA_NS, 'https://schemas.socioprophet.org/gaia/')
  assert.equal(doc['@graph'][0]!['@type'], 'gaia:CanonicalEntity')
})

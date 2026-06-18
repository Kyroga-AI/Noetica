import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEntity, CANONICAL_SHAPES, QUARANTINE_PROP } from './canonical-shapes.js'

test('valid FeatureAtom conforms', () => {
  assert.deepEqual(validateEntity(['FeatureAtom'], { surface: 'Redis', kind: 'TOOL' }), [])
})

test('FeatureAtom missing kind is flagged', () => {
  assert.deepEqual(validateEntity(['FeatureAtom'], { surface: 'Redis' }), ['FeatureAtom.kind'])
})

test('Interaction requires runId', () => {
  assert.deepEqual(validateEntity(['Interaction'], {}), ['Interaction.runId'])
  assert.deepEqual(validateEntity(['Interaction'], { runId: 'r1' }), [])
})

test('empty-string property counts as missing', () => {
  assert.deepEqual(validateEntity(['FeatureAtom'], { surface: '  ', kind: 'X' }), ['FeatureAtom.surface'])
})

test('unknown label has no requirements', () => {
  assert.deepEqual(validateEntity(['SomethingElse'], {}), [])
})

test('shapes + quarantine constants are wired', () => {
  assert.match(CANONICAL_SHAPES, /FeatureAtomShape/)
  assert.equal(QUARANTINE_PROP, 'shacl_quarantined')
})

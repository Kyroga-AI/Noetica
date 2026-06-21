import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dimensionOf, relationLabel, toCskgEdge, toKgtkTsv, CSKG_DIMENSIONS } from './cskg.js'

test('dimensionOf maps Noetica relations to CSKG dimensions', () => {
  assert.equal(dimensionOf('HAS_TOPIC'), 'taxonomic')      // domain → topic
  assert.equal(dimensionOf('PRODUCED'), 'creation')        // doc → chunk
  assert.equal(dimensionOf('TOUCHED'), 'part-whole')
  assert.equal(dimensionOf('HAS_TURN'), 'temporal')
  assert.equal(dimensionOf('LAW_OF'), 'causation')
  assert.equal(dimensionOf('TWIN_OF'), 'social')
  assert.equal(dimensionOf('COOCCURS_WITH'), 'co-occurrence')
  assert.equal(dimensionOf('SAME_AS'), 'similarity')
  // every result is a valid CSKG dimension
  for (const r of ['HAS_TERM', 'CLAIMS', 'WEIRD_UNKNOWN_REL', 'derives_from', 'located_near']) {
    assert.ok((CSKG_DIMENSIONS as readonly string[]).includes(dimensionOf(r)), `${r} → valid dimension`)
  }
})

test('keyword fallback for unknown relations', () => {
  assert.equal(dimensionOf('xyz_located_near'), 'spatial')
  assert.equal(dimensionOf('thing_causes_other'), 'causation')
  assert.equal(dimensionOf('totally_unknown'), 'functional')   // safe default
})

test('relationLabel humanizes', () => {
  assert.equal(relationLabel('HAS_TOPIC'), 'has topic')
  assert.equal(relationLabel('TERM_IN_DOMAIN'), 'term in domain')
})

test('toCskgEdge builds a spec-shaped record with dimension + provenance', () => {
  const e = toCskgEdge(
    { id: 'e1', label: 'HAS_TOPIC', from: 'domain:x', to: 'topic:y', properties: { source: 'graphbrain', sentence: 'x is about y' } },
    { node1: 'Domain X', node2: 'Topic Y' },
  )
  assert.equal(e.node1, 'domain:x')
  assert.equal(e.relation, 'HAS_TOPIC')
  assert.equal(e['relation;dimension'], 'taxonomic')
  assert.equal(e['relation;label'], 'has topic')
  assert.equal(e['node1;label'], 'Domain X')
  assert.equal(e.source, 'graphbrain')
  assert.equal(e.sentence, 'x is about y')
})

test('toKgtkTsv emits spec columns in order, tab-separated', () => {
  const tsv = toKgtkTsv([toCskgEdge({ label: 'PRODUCED', from: 'doc:1', to: 'chunk:1' })])
  const [header, row] = tsv.split('\n')
  assert.equal(header, 'id\tnode1\trelation\tnode2\tnode1;label\tnode2;label\trelation;label\trelation;dimension\tsource\tsentence')
  const cols = row!.split('\t')
  assert.equal(cols[1], 'doc:1')             // node1
  assert.equal(cols[2], 'PRODUCED')          // relation
  assert.equal(cols[7], 'creation')          // relation;dimension
})

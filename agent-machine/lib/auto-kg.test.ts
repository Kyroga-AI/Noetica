import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTriples, triplesToProposals, extractTriplesPrompt, extractKnowledgeGraph } from './auto-kg.js'

test('parses a clean JSON array of triples', () => {
  const out = parseTriples('[{"subject":"water","predicate":"contains","object":"lead"}]')
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { subject: 'water', predicate: 'contains', object: 'lead' })
})

test('robust to code fences + leading prose (extracts the JSON array)', () => {
  const reply = 'Here are the triples:\n```json\n[{"subject":"Baxter","predicate":"manufactured","object":"the IV bags"}]\n```\nDone.'
  const out = parseTriples(reply)
  assert.equal(out.length, 1)
  assert.equal(out[0]!.subject, 'Baxter')
})

test('validates: drops elements missing a field, trims + collapses whitespace', () => {
  const out = parseTriples('[{"subject":"  the   plant ","predicate":"uses","object":"tap water"},{"subject":"x","predicate":"y"}]')
  assert.equal(out.length, 1)
  assert.equal(out[0]!.subject, 'the plant')
})

test('dedupes case-insensitively and drops self-loops', () => {
  const out = parseTriples('[{"subject":"A","predicate":"rel","object":"B"},{"subject":"a","predicate":"REL","object":"b"},{"subject":"C","predicate":"is","object":"c"}]')
  assert.equal(out.length, 1)   // the two A/B dups collapse; C→c self-loop dropped
})

test('accepts s/p/o and relation aliases', () => {
  const out = parseTriples('[{"s":"sun","relation":"emits","o":"light"}]')
  assert.deepEqual(out[0], { subject: 'sun', predicate: 'emits', object: 'light' })
})

test('never throws on garbage — returns []', () => {
  assert.deepEqual(parseTriples('not json at all'), [])
  assert.deepEqual(parseTriples('[ broken json'), [])
  assert.deepEqual(parseTriples(''), [])
  assert.deepEqual(parseTriples('{"not":"an array"}'), [])
})

test('respects the max cap', () => {
  const big = '[' + Array.from({ length: 100 }, (_, i) => `{"subject":"s${i}","predicate":"p","object":"o${i}"}`).join(',') + ']'
  assert.equal(parseTriples(big, { max: 10 }).length, 10)
})

test('triplesToProposals → pending add-edge proposals tagged as auto-kg (NOT canonical)', () => {
  const props = triplesToProposals([{ subject: 'water', predicate: 'contains', object: 'lead' }], 'report.pdf')
  assert.equal(props.length, 1)
  assert.equal(props[0]!.op, 'add-edge')
  assert.equal(props[0]!.status, 'pending')               // governance: review-gated, not auto-canonical
  assert.equal(props[0]!.source, 'auto-kg:report.pdf')    // provenance: marked as auto-extraction
  assert.deepEqual(props[0]!.payload, { from: 'water', to: 'lead', rel: 'contains' })
})

test('extractKnowledgeGraph: model-agnostic end-to-end with an injected generate fn', async () => {
  const generate = async (p: string) => {
    assert.match(p, /JSON array of triples/)   // the prompt was built
    return '[{"subject":"plants","predicate":"rely on","object":"tap water"}]'
  }
  const r = await extractKnowledgeGraph('Plants rely on tap water.', 'doc1', generate)
  assert.equal(r.triples.length, 1)
  assert.equal(r.proposals[0]!.source, 'auto-kg:doc1')
})

test('extractKnowledgeGraph: empty text and model errors degrade to empty (never throws)', async () => {
  assert.deepEqual((await extractKnowledgeGraph('', 'd', async () => '[]')).triples, [])
  const r = await extractKnowledgeGraph('text', 'd', async () => { throw new Error('model down') })
  assert.deepEqual(r, { triples: [], proposals: [] })
})

test('extractTriplesPrompt truncates very long inputs', () => {
  const p = extractTriplesPrompt('x'.repeat(10000))
  assert.ok(p.length < 7000)
})

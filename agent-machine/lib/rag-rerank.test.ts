import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuseRerank, type RankableHit } from './rag-rerank.js'

const sem: RankableHit[] = [
  { docId: 'd1', filename: 'a.pdf', idx: 0, text: 'the clinic provides patient care services', score: 0.9 },
  { docId: 'd2', filename: 'b.pdf', idx: 4, text: 'a company located on Hospital Way downtown', score: 0.7 },
  { docId: 'd3', filename: 'c.pdf', idx: 1, text: 'unrelated content about gardening', score: 0.5 },
]
const lex: RankableHit[] = [
  { docId: 'd2', filename: 'b.pdf', idx: 4, text: 'a company located on Hospital Way downtown', score: 3 },
  { docId: 'd4', filename: 'd.pdf', idx: 2, text: 'hospital admissions rose last quarter', score: 2 },
]

test('a chunk both rankers like (RRF) floats above a single-ranker chunk', () => {
  const out = fuseRerank(sem, lex, 'hospital company', { limit: 5 })
  // d2#4 appears in BOTH semantic and lexical → should rank first
  assert.equal(out[0]!.docId, 'd2')
  assert.equal(out[0]!.signals.semanticRank, 2)
  assert.equal(out[0]!.signals.lexicalRank, 1)
})

test('per-chunk citation is filename#chunkIndex', () => {
  const out = fuseRerank(sem, lex, 'hospital', {})
  const d2 = out.find((r) => r.docId === 'd2')!
  assert.equal(d2.citation, 'b.pdf#4')
})

test('term-overlap boost lifts a literal keyword match', () => {
  // query "hospital" literally appears in d4 (lexical-only) — overlap boost should give it weight
  const out = fuseRerank(sem, lex, 'hospital', { limit: 5 })
  const d4 = out.find((r) => r.docId === 'd4')!
  assert.ok(d4.signals.termOverlap > 0, 'd4 should register term overlap on "hospital"')
  // the gardening chunk has zero overlap and only a weak semantic rank → ranks below d4
  const d3 = out.find((r) => r.docId === 'd3')!
  assert.ok(d4.fusedScore > d3.fusedScore)
})

test('dedupes by docId+chunkIndex, sums both rankers into one row', () => {
  const out = fuseRerank(sem, lex, 'hospital company', {})
  assert.equal(out.filter((r) => r.docId === 'd2').length, 1)
})

test('semantic hit without idx inherits the position from the lexical hit, else cites by filename', () => {
  const semNoIdx: RankableHit[] = [
    { docId: 'd2', filename: 'b.pdf', text: 'a company located on Hospital Way downtown', score: 0.8 }, // no idx
    { docId: 'd9', filename: 'e.pdf', text: 'pure semantic only chunk', score: 0.6 }, // no idx, semantic-only
  ]
  const out = fuseRerank(semNoIdx, lex, 'hospital company', { limit: 5 })
  const d2 = out.find((r) => r.docId === 'd2')!
  assert.equal(d2.citation, 'b.pdf#4')      // inherited idx 4 from the lexical ranker
  const d9 = out.find((r) => r.docId === 'd9')!
  assert.equal(d9.chunkIndex, null)
  assert.equal(d9.citation, 'e.pdf')         // no position anywhere → filename-only citation
})

test('respects limit and is deterministic', () => {
  const a = fuseRerank(sem, lex, 'care', { limit: 2 })
  const b = fuseRerank(sem, lex, 'care', { limit: 2 })
  assert.equal(a.length, 2)
  assert.deepEqual(a.map((r) => r.citation), b.map((r) => r.citation))
})

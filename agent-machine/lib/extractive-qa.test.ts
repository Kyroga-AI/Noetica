import { test } from 'node:test'
import assert from 'node:assert'
import { extractiveAnswer } from './extractive-qa.js'
import type { ChunkHit } from './doc-store.js'

function hit(text: string, filename = 'report.docx', score = 0.6): ChunkHit {
  return { text, filename, score, docId: 'urn:doc:1' }
}

test('extracts the on-topic sentence verbatim and cites it', () => {
  const hits = [
    hit('The facility uses municipal water. In September 2024, the Baxter North Cove plant flooded during Hurricane Helene, halting IV-fluid production. Demand rose afterward.'),
    hit('Unrelated boilerplate about quarterly filings and accounting standards that should not surface.'),
  ]
  const ex = extractiveAnswer('what happened at the Baxter North Cove plant during Hurricane Helene?', hits)
  assert.ok(ex, 'should produce an answer')
  assert.match(ex!.answer, /Baxter North Cove plant flooded during Hurricane Helene/)
  assert.match(ex!.answer, /\[1\]/)               // cited
  assert.doesNotMatch(ex!.answer, /quarterly filings/) // off-topic chunk excluded
})

test('cannot fabricate — returns null when nothing matches', () => {
  const hits = [hit('This passage is entirely about unrelated logistics and shipping schedules.')]
  const ex = extractiveAnswer('what is the capital of France?', hits)
  assert.equal(ex, null)
})

test('verbatim — every used sentence exists in a source chunk', () => {
  const hits = [hit('Water scarcity is a key risk. Drought reduces municipal supply. Costs rise sharply.')]
  const ex = extractiveAnswer('what are the key water risks and costs?', hits)
  assert.ok(ex)
  for (const u of ex!.used) {
    assert.ok(hits.some((h) => h.text.includes(u.text)), `"${u.text}" must be verbatim from a chunk`)
  }
})

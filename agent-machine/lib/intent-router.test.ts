import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyIntent, capabilityToTask, wantsVectorRag } from './intent-router.js'

test('the transcript failures route correctly now', () => {
  // pharma summary → general + vector-rag (NOT the coder)
  const sum = classifyIntent('Summarize the key points of this report')
  assert.equal(sum.name, 'summarize_doc'); assert.equal(sum.model, 'general'); assert.equal(sum.retrieval, 'vector-rag')
  assert.equal(capabilityToTask(sum.model), 'general') // not 'coding'

  // "research this" with a doc loaded → grounded vector-rag, not free hallucination
  const q = classifyIntent('can you research this for me? what happened to Baxter?', { hasDoc: true })
  assert.ok(q.retrieval === 'vector-rag' || q.retrieval === 'web+vector')

  // bare question + doc loaded → qa_over_doc (vector grounded)
  const bare = classifyIntent('Is there a drought problem in the US?', { hasDoc: true })
  assert.equal(bare.retrieval, 'vector-rag')
})

test('specialists only on real cues', () => {
  assert.equal(classifyIntent('fix the upload, it crashes').model, 'code')
  assert.equal(classifyIntent('compute the determinant of [[2,1],[1,3]]').retrieval, 'program-aided')
  assert.equal(classifyIntent('hi there').model, 'concierge')
  assert.equal(classifyIntent('what are the gaps and best next steps?').name, 'plan_nextsteps')
  assert.equal(classifyIntent('how do you work? which repos build you?').name, 'self_identity')
})

test('vector-rag flag', () => {
  assert.equal(wantsVectorRag('vector-rag'), true)
  assert.equal(wantsVectorRag('kb'), false)
})

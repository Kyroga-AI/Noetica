import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyIntent, capabilityToTask, wantsVectorRag, deEscalateEveryday, planFromIntent, intentByName } from './intent-router.js'

test('REGRESSION: "how to make coffee" is everyday, NOT a build (no app-building)', () => {
  const p = classifyIntent('how to make coffee')
  assert.equal(p.name, 'everyday')
  assert.equal(p.model, 'general')
  assert.deepEqual(p.tools, []) // the everyday lane can NEVER build/run anything
  assert.notEqual(p.surface, 'code')
})

test('everyday how-tos route to the everyday lane', () => {
  for (const q of ['how do i make scrambled eggs', 'recipe for banana bread', 'how to brew coffee', 'how do i remove a wine stain']) {
    assert.equal(classifyIntent(q).name, 'everyday', q)
  }
})

test('deEscalateEveryday redirects a build intent on an everyday, non-technical query', () => {
  const build = planFromIntent(intentByName('build_implement')!, 2)
  const fixed = deEscalateEveryday(build, 'how to make coffee')
  assert.equal(fixed.name, 'everyday')
  assert.deepEqual(fixed.tools, [])
})

test('deEscalateEveryday does NOT touch a legit technical build', () => {
  const build = planFromIntent(intentByName('build_implement')!, 2)
  // "coffee tracking app" has a technical signal (app) → stays a build
  assert.equal(deEscalateEveryday(build, 'build me a coffee tracking app').name, 'build_implement')
  assert.equal(deEscalateEveryday(build, 'build a login form with react').name, 'build_implement')
})

test('a real software build still classifies as build_implement', () => {
  assert.equal(classifyIntent('build a REST API with authentication').name, 'build_implement')
  assert.equal(classifyIntent('create a dashboard component').name, 'build_implement')
})

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

test('write-and-run-code routes to a code intent with code_execute (not write_draft)', () => {
  // The "Write code" quick action: was mis-routing to write_draft (writing model,
  // no code_execute) → the model faked the output instead of running it.
  const r = classifyIntent('Write a Python function that reverses a string, then run it and show the output.')
  assert.equal(r.name, 'build_implement')
  assert.ok(r.tools.includes('code_execute'), 'must be able to actually execute')
  assert.equal(capabilityToTask(r.model), 'coding') // the dedicated coder, not the 3B draft writer

  // prose writing still routes to write_draft (we did not swallow real writing tasks)
  assert.equal(classifyIntent('write me a poem about the sea').name, 'write_draft')
  assert.equal(classifyIntent('draft an email to my landlord').name, 'write_draft')
  assert.equal(classifyIntent('write a blog post about local-first AI').name, 'write_draft')
  // other code-artifact phrasings also reach a code-executing intent
  assert.ok(classifyIntent('create a script to rename files').tools.includes('code_execute'))
})

test('vector-rag flag', () => {
  assert.equal(wantsVectorRag('vector-rag'), true)
  assert.equal(wantsVectorRag('kb'), false)
})

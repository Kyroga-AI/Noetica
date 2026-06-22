/**
 * Tests for the decidability-ladder solver. Also de-orphans the module: this is the first non-bench
 * importer of lib/logic-solver, validating the contract the server's opt-in gate now depends on.
 *
 * We assert the deterministic edges (UNDECIDABLE fall-through, result shape, signature contract) rather
 * than the recall/compute/extract tiers, which need crystallized/python/document fixtures.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solveByLogic, godelSignature } from './logic-solver.js'

const NONSENSE = 'zqxblort wibblewobble fizztriction ' + Math.random()

test('a non-decidable free-form question falls through to UNDECIDABLE (→ generator)', () => {
  // hasDoc:false skips the EXTRACT tier so the result is independent of any ingested corpus.
  const r = solveByLogic(NONSENSE, { hasDoc: false })
  assert.equal(r.method, 'undecidable')
  assert.equal(r.answer, null)
  assert.equal(r.decidable, false)
})

test('the result shape is always well-formed', () => {
  const r = solveByLogic('what is the meaning of zorptfizzle', { hasDoc: false })
  assert.ok(['recall', 'compute', 'extract', 'infer', 'undecidable'].includes(r.method))
  assert.equal(typeof r.decidable, 'boolean')
  assert.ok(r.answer === null || typeof r.answer === 'string')
})

test('godelSignature returns a string or undefined and never throws', () => {
  assert.doesNotThrow(() => godelSignature('photosynthesis in plants'))
  const s = godelSignature('the derivative of x squared')
  assert.ok(s === undefined || typeof s === 'string')
})

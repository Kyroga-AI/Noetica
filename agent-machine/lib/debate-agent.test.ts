/** End-to-end tests for the Debater agent loop (lib/debate-agent.ts): text → detectors → reasoner →
 *  verdict. Validates that the full path holds the reasoner's properties (composition, grounding-offset,
 *  self-abstention, policy-block) with REAL detector text, not synthetic firings. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeDebate, explainClaim, type DebateInput } from './debate-agent.js'

test('a clean, hedged claim passes end-to-end and the set is clear', () => {
  const v = analyzeDebate({ claims: [{ id: 'c1', text: 'The 2021 study suggests the effect is likely, pending more data.' }] })
  assert.equal(v.clear, true)
  assert.equal(v.claims[0]!.severity, 'pass')
  assert.equal(v.claims[0]!.hits.length, 0)
  assert.match(v.ruleset_hash, /^sha256:/)   // audit anchor present
})

test('a multi-fallacy claim is flagged (severity worse than pass) with detector rationale attached', () => {
  const v = analyzeDebate({
    claims: [{ id: 'c1', text: "So you're saying we should never regulate anything? You're just a shill, and everyone knows experts agree." }],
  })
  assert.notEqual(v.claims[0]!.severity, 'pass')       // multiple detections drag pSound down
  assert.ok(v.claims[0]!.hits.length >= 2)             // at least strawman + ad-hominem
  assert.ok(v.claims[0]!.pSound < 0.5)
})

test('grounded evidence offsets detections — the reasoner is not overridden by the detector layer', () => {
  const text = "So you're saying we should never do this? Everyone knows it."
  const withoutGrounding = analyzeDebate({ claims: [{ id: 'c1', text }] })
  const withGrounding = analyzeDebate({
    claims: [{ id: 'c1', text }],
    groundedEvidence: Array.from({ length: 5 }, (_, i) => ({ targetClaim: 'c1', weight: 1.5, evidenceId: `ev${i}` })),
  })
  assert.ok(withGrounding.claims[0]!.pSound > withoutGrounding.claims[0]!.pSound, 'grounding raises soundness')
})

test('§2 ED-2 self-abstention via implicationStrengths: a decayed detector rule exerts no force', () => {
  const text = "So you're saying we should never do this?"   // fires STRAWMAN
  const normal = analyzeDebate({ claims: [{ id: 'c1', text }] })
  const abstained = analyzeDebate({ claims: [{ id: 'c1', text }], implicationStrengths: { 'LOGFALL.STRAWMAN.V1': 0.01 } })
  // the firing still appears in the audit hits, but its inference force is gone → pSound moves back toward 0.5
  assert.ok(abstained.claims[0]!.pSound > normal.claims[0]!.pSound)
  assert.ok(abstained.claims[0]!.hits.length >= 1)   // still audited
})

test('§5 policy hard-constraint blocks a claim the detectors would have passed', () => {
  const v = analyzeDebate({
    claims: [{ id: 'c1', text: 'A perfectly reasonable and well-hedged statement.' }],
    policyConstraints: [{ claim: 'c1', reason: 'POLICY.HARD.V1' }],
  })
  assert.equal(v.claims[0]!.severity, 'block')
  assert.equal(v.clear, false)
})

test('explainClaim yields a deterministic human-readable rationale line', () => {
  const v = analyzeDebate({ claims: [{ id: 'c1', text: "You're just a fool." }] })
  const line = explainClaim(v.claims[0]!)
  assert.match(line, /P_sound=/)
  assert.match(line, /LOGFALL\.ADHOMINEM/)
})

test('multiple claims judged independently; a clean claim stays pass beside a flagged one', () => {
  const v = analyzeDebate({
    claims: [
      { id: 'c1', text: "You're either with us or against us." },              // false dichotomy
      { id: 'c2', text: 'The measured value was 3.2 based on the calibration.' }, // clean
    ],
  })
  assert.equal(v.claims.find((c) => c.claim === 'c2')!.severity, 'pass')
  assert.equal(v.claims.find((c) => c.claim === 'c2')!.hits.length, 0)
})

test('the verdict carries ruleset provenance (semver + hash) on every run', () => {
  const v = analyzeDebate({ claims: [{ id: 'c1', text: 'anything' }] })
  assert.equal(v.ruleset_semver, '0.1.0')
  assert.match(v.ruleset_hash, /^sha256:[0-9a-f]{32}$/)
})

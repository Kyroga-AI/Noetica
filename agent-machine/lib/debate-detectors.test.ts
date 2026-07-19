/** Tests for the deterministic detector library (lib/debate-detectors.ts). Detectors must fire on the
 *  obvious cases, stay deterministic, and produce a stable ruleset_hash. They are heuristic first-pass,
 *  so tests assert "fires / doesn't fire" on clear cases, not perfect precision. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runDetectors, rulesetHash, detectorIds, RULESET_SEMVER } from './debate-detectors.js'

const fired = (text: string, ruleId: string) => runDetectors(text).some((h) => h.ruleId === ruleId)

test('STRAWMAN fires on a restatement cue + absolute quantifier', () => {
  assert.ok(fired("So you're saying we should never have any regulations at all?", 'LOGFALL.STRAWMAN.V1'))
})

test('AD-HOMINEM fires on a personal attack', () => {
  assert.ok(fired("You're just a shill for the industry, so your point is invalid.", 'LOGFALL.ADHOMINEM.V1'))
})

test('SLIPPERY-SLOPE fires on an escalating-consequence cue', () => {
  assert.ok(fired('If we allow this, next thing you know everything is banned.', 'LOGFALL.SLIPPERYSLOPE.V1'))
})

test('FALSE-DICHOTOMY fires on either/or framing', () => {
  assert.ok(fired("You're either with us or against us on this policy.", 'LOGFALL.FALSEDICHOTOMY.V1'))
})

test('HASTY-GENERALIZATION fires on absolute + anecdote', () => {
  assert.ok(fired('Every economist is wrong — I met one who couldn\'t explain inflation.', 'LOGFALL.HASTYGEN.V1'))
})

test('APPEAL-TO-AUTHORITY fires on vague authority, but is DOWNWEIGHTED when a citation is present', () => {
  const vague = runDetectors('Experts say this is settled science.').find((h) => h.ruleId === 'LOGFALL.APPEALAUTHORITY.V1')
  const cited = runDetectors('Experts say this is settled (Smith et al. 2021, doi:10.1/x).').find((h) => h.ruleId === 'LOGFALL.APPEALAUTHORITY.V1')
  assert.ok(vague && vague.score > 0.5)
  assert.ok(cited && cited.score < 0.3)   // citation reduces the fallacy signal, not eliminates it
})

test('CONFIRMATION-BIAS fires on "this just proves what I always said"', () => {
  assert.ok(fired('This just proves what I have always said about them.', 'COGBIAS.CONFIRM.V1'))
})

test('ABSOLUTE-CERTAINTY fires on unhedged certainty, but NOT when hedged', () => {
  assert.ok(fired('This is undeniably the only correct interpretation.', 'COGBIAS.ABSOLUTECERTAINTY.V1'))
  assert.ok(!fired('This is arguably a strong interpretation, though I might be wrong.', 'COGBIAS.ABSOLUTECERTAINTY.V1'))
})

test('a clean, well-hedged claim fires NO detectors', () => {
  const hits = runDetectors('Based on the 2021 study, the effect appears likely, though more data would help.')
  assert.equal(hits.length, 0)
})

test('detectors are deterministic: same input → identical output', () => {
  const t = "So you're saying we should always trust experts?"
  assert.deepEqual(runDetectors(t), runDetectors(t))
})

test('every hit has a score in [0,1], a span, and a rationale', () => {
  for (const h of runDetectors("You're either with us or against us, and everyone knows it.")) {
    assert.ok(h.score >= 0 && h.score <= 1)
    assert.ok(h.span.length > 0)
    assert.ok(h.rationale.length > 0)
  }
})

test('rulesetHash is stable and versioned; ids are non-empty', () => {
  assert.match(rulesetHash(), /^sha256:[0-9a-f]{32}$/)
  assert.equal(rulesetHash(), rulesetHash())     // stable across calls
  assert.ok(detectorIds().length >= 8)
  assert.equal(RULESET_SEMVER, '0.1.0')
})

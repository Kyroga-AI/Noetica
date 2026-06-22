/** Tests for the shared council combiner (Council V2, grounding-weighted). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { councilVote } from './council.js'

test('V2: grounded retrieval consensus beats the correlated closed-book bloc (the dilution fix)', () => {
  // brain+qgen agree on B with strong grounding; baseline+manip+sc are the wrong A. V2 must pick B.
  const r = councilVote(
    { baseline: 'A', brain: 'B', qgen: 'B', brainConf: 0.8, qgenConf: 0.8, manip: 'A', scLetter: 'A', scAgree: 0.6 },
    { v2: true },
  )
  assert.equal(r.letter, 'B')
})

test('V2: weak grounding defers to the reasoning vote', () => {
  // brain says B but its grounding is ~0; baseline+manip+sc agree on C → C wins.
  const r = councilVote(
    { baseline: 'C', brain: 'B', qgen: 'D', brainConf: 0.05, qgenConf: 0.05, manip: 'C', scLetter: 'C', scAgree: 0.8 },
    { v2: true },
  )
  assert.equal(r.letter, 'C')
})

test('never blindly defaults to A (positional-bias guard)', () => {
  const r = councilVote({ baseline: 'A', brain: 'B', scLetter: 'B', scAgree: 0 }, { v2: false, manip: false })
  assert.notEqual(r.letter, 'A')
})

test('V1 flat council still available (v2:false)', () => {
  // three arms agree on A; one sc vote cannot overturn a 3-arm consensus.
  const r = councilVote({ baseline: 'A', brain: 'A', qgen: 'A', scLetter: 'B', scAgree: 0 }, { v2: false, manip: false })
  assert.equal(r.letter, 'A')
})

test('ignores undefined / "?" arm votes', () => {
  const r = councilVote({ brain: 'B', qgen: '?', scLetter: 'B', scAgree: 0.5 }, { v2: true, manip: false })
  assert.equal(r.letter, 'B')
})

test('a NaN scAgree does not poison the tally (clamped to 0)', () => {
  // grounded brain+qgen consensus on B must still win even if an upstream Number(undefined) makes
  // scAgree NaN — the old raw use would write NaN into the tally and break the sort comparator.
  const r = councilVote(
    { brain: 'B', qgen: 'B', brainConf: 0.7, qgenConf: 0.7, scLetter: 'A', scAgree: NaN as unknown as number },
    { v2: true, manip: false },
  )
  assert.equal(r.letter, 'B')
})

test('tie-break is letter-neutral and deterministic, not biased for/against A', () => {
  // Two retrieval arms tie at equal grounding; scLetter is a third letter. The winner is the
  // alphabetically-first of the tied pair regardless of WHICH arm carried it — no 'A' bias either way.
  const a = councilVote({ brain: 'A', qgen: 'D', brainConf: 0.5, qgenConf: 0.5, scLetter: 'C', scAgree: 0 }, { v2: true, manip: false })
  const b = councilVote({ brain: 'D', qgen: 'A', brainConf: 0.5, qgenConf: 0.5, scLetter: 'C', scAgree: 0 }, { v2: true, manip: false })
  assert.equal(a.letter, 'A')
  assert.equal(b.letter, 'A') // same result when the arms are swapped → decided by letter, not position
})

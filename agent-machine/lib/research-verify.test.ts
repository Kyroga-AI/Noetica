/** Tests for the grounding verifiers — the lexical baseline + the entailment upgrade. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyGrounding, verifyGroundingNLI, makeLlmEntail, type EntailFn } from './research-verify.js'

const SOURCES = [
  { text: 'The capital of France is Paris. Paris sits on the river Seine.' },
  { text: 'Water boils at 100 degrees celsius at sea level.' },
]
// One grounded claim, one hallucination.
const ANSWER = 'Paris is the capital of France. The moon is made of green cheese.'

// Deterministic stub entailer: entailed iff every content word of the claim is in the premise.
const stubEntail: EntailFn = async (premise, hyp) => {
  const p = premise.toLowerCase()
  const words = hyp.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)
  return words.every((w) => p.includes(w)) ? 1 : 0
}

test('lexical verifyGrounding flags the hallucinated claim', () => {
  const r = verifyGrounding(ANSWER, SOURCES)
  assert.equal(r.total, 2)
  assert.ok(r.unsupported.some((u) => u.toLowerCase().includes('moon')), 'moon claim flagged')
})

test('NLI grounding: grounded claim entailed, hallucination unsupported', async () => {
  const r = await verifyGroundingNLI(ANSWER, SOURCES, stubEntail, { passAt: 0.7 })
  assert.equal(r.total, 2)
  assert.equal(r.supported, 1, 'only the Paris claim is entailed')
  assert.ok(r.unsupported.some((u) => u.toLowerCase().includes('moon')), 'moon claim unsupported')
  assert.equal(r.grounded, false, 'score 0.5 < passAt 0.7')
})

test('NLI grounding: passAt threshold honored', async () => {
  const r = await verifyGroundingNLI(ANSWER, SOURCES, stubEntail, { passAt: 0.5 })
  assert.equal(r.grounded, true, 'score 0.5 >= passAt 0.5')
})

test('NLI grounding: a claim with no similar source is unsupported (nothing to entail from)', async () => {
  // entailer that would say yes to anything — must still fail because no source is selected as premise
  const r = await verifyGroundingNLI('Quantum chromodynamics confines quarks.', SOURCES, async () => 1)
  assert.equal(r.supported, 0)
  assert.equal(r.grounded, false)
})

test('makeLlmEntail maps the judge verdict to a score', async () => {
  const yes = makeLlmEntail(async () => 'ENTAILED')
  const no = makeLlmEntail(async () => 'CONTRADICTED, the evidence disagrees')
  const meh = makeLlmEntail(async () => 'NEUTRAL')
  assert.equal(await yes('e', 'h'), 1)
  assert.equal(await no('e', 'h'), 0)
  assert.ok((await meh('e', 'h')) < 0.5)
})

test('combo grounding fuses lexical + entailment (needs agreement to ground)', async () => {
  const { verifyGroundingCombo } = await import('./research-verify.js')
  const entail = async (p: string, h: string) => (p.toLowerCase().includes('paris') && h.toLowerCase().includes('paris') ? 1 : 0)
  const r = await verifyGroundingCombo(ANSWER, SOURCES, { entail }, { passAt: 0.5 })
  assert.equal(r.total, 2)
  assert.ok(r.supported >= 1, 'Paris claim supported by lex+nli agreement')
  assert.ok(r.unsupported.some((u) => u.toLowerCase().includes('moon')), 'moon claim unsupported')
})

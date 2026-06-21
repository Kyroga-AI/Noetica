import { test } from 'node:test'
import assert from 'node:assert/strict'
import { critique, scoreCandidate, bestOfTemps, type Candidate, type CriticContext } from './critic.js'

const CTX = (over: Partial<CriticContext> = {}): CriticContext => ({
  question: 'what is the capital of france and its population',
  contextText: 'Paris is the capital of France. The population of Paris is about 2.1 million people in the city proper.',
  beliefs: [], laws: [], ...over,
})

test('critic: a well-grounded candidate beats an ungrounded one and is ACCEPTED', () => {
  const cands: Candidate[] = [
    { content: 'The capital of France is Paris, with a population of about 2.1 million.', temperature: 0.3 },
    { content: 'I think it might be Lyon or somewhere, not totally sure honestly.', temperature: 0.9 },
  ]
  const v = critique(cands, CTX())
  assert.match(v.best.candidate.content, /Paris/)
  assert.equal(v.action, 'accept')
  assert.ok(v.best.score >= v.ranked[v.ranked.length - 1]!.score)
})

test('critic: when every candidate is weakly grounded, the gate ESCALATES (not ship-as-fact)', () => {
  const cands: Candidate[] = [
    { content: 'It is probably some large city with many residents.', temperature: 0.3 },
    { content: 'Could be anywhere really, hard to say without more info.', temperature: 0.9 },
  ]
  // verifiable lookup posture forced → high accept bar
  const v = critique(cands, CTX({ posture: 'lookup' }))
  assert.equal(v.action, 'escalate')
})

test('critic: a contradiction against a promoted belief triggers CLARIFY', () => {
  const cands: Candidate[] = [
    { content: 'Paris is not the capital of France; that is incorrect.', temperature: 0.4 },
  ]
  const v = critique(cands, CTX({
    beliefs: [{ claim: 'Paris is the capital of France' }],
  }))
  assert.equal(v.action, 'clarify')
})

test('critic: self-consistency breaks near-ties toward the consensus answer', () => {
  // Three candidates agree on Paris/2.1M, one outlier. The consensus should win even
  // if the outlier scores within epsilon.
  const cands: Candidate[] = [
    { content: 'Paris is the capital of France, population about 2.1 million.', temperature: 0.2 },
    { content: 'The capital of France is Paris; its population is around 2.1 million.', temperature: 0.5 },
    { content: 'France\'s capital is Paris with roughly 2.1 million people.', temperature: 0.8 },
  ]
  const v = critique(cands, CTX())
  assert.match(v.best.candidate.content, /Paris/)
  assert.ok(v.agreement > 0.2, `expected meaningful agreement, got ${v.agreement}`)
})

test('critic: empty candidate set escalates safely', () => {
  const v = critique([{ content: '' }], CTX())
  assert.equal(v.action, 'escalate')
})

test('critic: scoreCandidate zeroes out degenerate (too-short) answers', () => {
  const s = scoreCandidate({ content: 'ok' }, CTX())
  assert.equal(s.score, 0)
})

test('bestOfTemps spreads N temperatures across the diversity range', () => {
  assert.deepEqual(bestOfTemps(1), [0.4])
  const t3 = bestOfTemps(3)
  assert.equal(t3.length, 3)
  assert.equal(t3[0], 0.2)
  assert.equal(t3[2], 0.9)
  assert.ok(t3[1]! > t3[0]! && t3[1]! < t3[2]!)
})

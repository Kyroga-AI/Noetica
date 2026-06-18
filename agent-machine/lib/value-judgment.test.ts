import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeAnswer } from './value-judgment.js'

test('grounded answer scores high grounding + grounded verdict', () => {
  const vj = judgeAnswer({
    answer: 'The authentication service uses JWT tokens stored in Redis.',
    contextText: 'authentication service JWT tokens Redis session store',
    beliefs: [], laws: [],
  })
  assert.ok(vj.grounding > 0.5, `expected high grounding, got ${vj.grounding}`)
  assert.equal(vj.verdict, 'grounded')
})

test('ungrounded answer is flagged speculative', () => {
  const vj = judgeAnswer({
    answer: 'Quantum entanglement enables faster-than-light communication across galaxies.',
    contextText: 'user prefers dark mode and lives in Boston',
    beliefs: [], laws: [],
  })
  assert.ok(vj.grounding < 0.2)
  assert.equal(vj.verdict, 'speculative')
})

test('detects a contradiction against a candidate law', () => {
  const vj = judgeAnswer({
    answer: 'Michael definitely works on weekends and never takes breaks.',
    contextText: 'Michael weekends breaks schedule',
    beliefs: [],
    laws: [{ law: 'Michael does not work on weekends', confidence: 0.9 }],
  })
  assert.equal(vj.verdict, 'contradiction')
  assert.ok(vj.contradictions.length >= 1)
  assert.equal(vj.contradictions[0]!.kind, 'law')
})

test('worth is penalised by contradictions (same world model, agree vs negate)', () => {
  const law = [{ law: 'tokens are stored in Redis', confidence: 0.8 }]
  const ctx = 'Redis session tokens stored'
  const clean = judgeAnswer({ answer: 'The tokens are stored in Redis', contextText: ctx, beliefs: [], laws: law })
  const conflicted = judgeAnswer({ answer: 'The tokens are not stored in Redis at all', contextText: ctx, beliefs: [], laws: law })
  assert.equal(clean.verdict, 'grounded')
  assert.equal(conflicted.verdict, 'contradiction')
  assert.ok(conflicted.worth < clean.worth, `expected ${conflicted.worth} < ${clean.worth}`)
})

test('PLN graph grounding lifts a token-ungrounded answer out of speculative', () => {
  // token grounding is ~0 (no overlap with contextText), but the graph knows the claims
  const vj = judgeAnswer({
    answer: 'Kubernetes orchestrates the Redis cluster',
    contextText: 'unrelated snippet about coffee',
    beliefs: [], laws: [],
    graphGrounding: 0.8, novelClaims: [],
  })
  assert.equal(vj.graph_grounding, 0.8)
  assert.equal(vj.verdict, 'grounded')
  assert.ok(vj.worth >= 0.48)
})

test('novel claims (not in graph) are surfaced in notes', () => {
  const vj = judgeAnswer({
    answer: 'Atlantis powers the mainframe', contextText: '', beliefs: [], laws: [],
    graphGrounding: 0, novelClaims: ['Atlantis'],
  })
  assert.deepEqual(vj.novel_claims, ['Atlantis'])
  assert.ok(vj.notes.some((n) => n.includes('not found in the knowledge graph')))
})

test('handles empty world model without throwing', () => {
  const vj = judgeAnswer({ answer: 'hello', contextText: '', beliefs: [], laws: [] })
  assert.ok(vj.worth >= 0 && vj.worth <= 1)
  assert.ok(vj.notes.some((n) => n.includes('no belief/law state')))
})

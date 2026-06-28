import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groundTiered, type TierTopic } from './topic-tier.js'

// The canonical case: "general physics" is the connective tissue bridging the universal (KKO) down to the
// rigorous "college_physics: E&M". Graduate QFT injects into a DIFFERENT general parent → structurally barred.
const physicsSpace: TierTopic[] = [
  { tier: 'upper', id: 'kko:physical-law', cos: 0.80 },
  { tier: 'middle', id: 'general physics', cos: 0.55 },
  { tier: 'lower', id: 'college_physics: E&M', cos: 0.62, injectsInto: 'general physics' },
  { tier: 'lower', id: 'graduate: Particle Physics & QFT', cos: 0.66, injectsInto: 'particle physics' },
]

test('general-first: grounds at general physics, then INJECTS to the specific that maps into it', () => {
  const g = groundTiered(physicsSpace)
  assert.equal(g.general, 'general physics')
  assert.equal(g.specific, 'college_physics: E&M')
  // general physics has exactly one realization here (E&M) → injection is also a bijection
  assert.deepEqual(g.crossings, ['surjection', 'injection', 'bijection'])
  assert.equal(g.grounded, true)
})

test('the graduate-QFT drag is barred STRUCTURALLY, not by a floor (it has a higher cos but the wrong general parent)', () => {
  const g = groundTiered(physicsSpace)
  // QFT cos 0.66 > E&M 0.62, but QFT injects into 'particle physics' ≠ the established 'general physics'
  assert.notEqual(g.specific, 'graduate: Particle Physics & QFT')
})

test('surjection guarantees coverage: upper anchors even when no general clears the floor', () => {
  const g = groundTiered([
    { tier: 'upper', id: 'kko:physical-science', cos: 0.7 },
    { tier: 'middle', id: 'general physics', cos: 0.30 },              // below MIDDLE_FLOOR
    { tier: 'lower', id: 'college_physics: E&M', cos: 0.9, injectsInto: 'general physics' },
  ])
  assert.equal(g.level, 'upper')
  assert.equal(g.anchor, 'kko:physical-science')
  assert.equal(g.grounded, false)     // a strong lower can't ground without its general bridge established first
})

test('stay general when no specific injects into the established general above floor', () => {
  const g = groundTiered([
    { tier: 'upper', id: 'kko:physical-law', cos: 0.8 },
    { tier: 'middle', id: 'general physics', cos: 0.6 },
    { tier: 'lower', id: 'college_physics: E&M', cos: 0.40, injectsInto: 'general physics' },   // below LOWER_FLOOR
  ])
  assert.equal(g.level, 'middle')
  assert.equal(g.general, 'general physics')
  assert.equal(g.specific, null)
  assert.deepEqual(g.crossings, ['surjection'])
})

test('bijection flagged when the general has exactly one specific realization', () => {
  const g = groundTiered([
    { tier: 'upper', id: 'kko:Generals', cos: 0.7 },
    { tier: 'middle', id: 'general statistics', cos: 0.6 },
    { tier: 'lower', id: 'hs_statistics', cos: 0.7, injectsInto: 'general statistics' },   // the only realization
  ])
  assert.ok(g.crossings.includes('injection'))
  assert.ok(g.crossings.includes('bijection'))
})

test('NOT a bijection when the general has multiple specific realizations', () => {
  const g = groundTiered(physicsSpace.concat([{ tier: 'lower', id: 'college_physics: mechanics', cos: 0.55, injectsInto: 'general physics' }]))
  assert.ok(g.crossings.includes('injection'))
  assert.ok(!g.crossings.includes('bijection'))   // E&M + mechanics both inject into general physics → not 1:1
})

test('no candidates → ungrounded, never throws', () => {
  const g = groundTiered([])
  assert.equal(g.grounded, false)
  assert.equal(g.general, null)
})

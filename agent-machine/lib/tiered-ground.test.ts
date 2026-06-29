import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTierCandidates, tieredGround, lexicalScore, type Scorer } from './tiered-ground.js'
import { distillExperience, type ReasoningExperience } from './procedural-memory.js'

// Deterministic scorer for the canonical scenario: a COLLEGE E&M physics question. E&M scores highest, the
// physics anchor + "general physics" middle score high, everything else (other physics lowers, other domains,
// KKO categories) scores low. This isolates the TRAVERSAL from embedding quality.
const physicsEM: Scorer = (_q, text) => {
  if (/electromagnet/i.test(text)) return 0.9      // the specific lower we want
  if (/\bphysics\b/i.test(text)) return 0.7        // physics anchor + "general physics" middle
  return 0.25
}

test('grounds college E&M GENERAL-FIRST: physics anchor → general physics → physics: Electromagnetism', async () => {
  const r = await tieredGround('A college E&M problem: compute the electric flux through a Gaussian surface', { scorer: physicsEM })
  assert.equal(r.grounding.anchor, 'anchor:physics')          // upper: surjective coverage
  assert.equal(r.grounding.general, 'general physics')        // middle: the connective tissue, established first
  assert.equal(r.grounding.specific, 'physics: Electromagnetism')  // lower: refined into, INJECTS into general physics
  assert.equal(r.grounding.level, 'lower')
  assert.ok(r.grounding.grounded)
  // the morphisms actually crossed: upper→middle surjection, then lower→middle injection
  assert.deepEqual(r.grounding.crossings, ['surjection', 'injection'])
  assert.match(r.block, /general \(connective\): general physics/)
})

test('the graduate-QFT drag is barred STRUCTURALLY: a high-level topic that does not inject into the chosen general is excluded', async () => {
  // a scorer that loves "Quantum" (graduate) AND "general physics" — but Quantum injects into general physics too,
  // so to prove the STRUCTURAL bar we give a lower that injects into a DIFFERENT general (mathematics) a high score.
  const mixed: Scorer = (_q, text) => {
    if (/group theory|abstract algebra/i.test(text)) return 0.95   // a MATH lower, injects into "general mathematics"
    if (/\bphysics\b/i.test(text)) return 0.7                      // physics anchor + general physics win the middle
    return 0.2
  }
  const r = await tieredGround('a physics question that mentions symmetry', { scorer: mixed })
  // general physics is the established middle; the high-scoring math lower injects into general mathematics, NOT
  // general physics, so it is structurally excluded — we do NOT refine into it.
  assert.equal(r.grounding.general, 'general physics')
  assert.notEqual(r.grounding.specific, 'mathematics: Abstract Algebra (Group Theory)')
})

test('stays GENERAL when no specific topic injects into the middle above the floor', async () => {
  // match only the anchor/general DESCRIPTION (unique phrase "study of matter, energy"), never a lower topic text.
  const generalOnly: Scorer = (_q, text) => (/study of matter, energy/i.test(text) ? 0.7 : 0.2)
  const r = await tieredGround('a general physics conceptual question', { scorer: generalOnly })
  assert.equal(r.grounding.general, 'general physics')
  assert.equal(r.grounding.specific, null)
  assert.equal(r.grounding.level, 'middle')
  assert.deepEqual(r.grounding.crossings, ['surjection'])
})

test('candidates carry the three tiers with correct structural links', async () => {
  const cands = await buildTierCandidates('physics', { scorer: physicsEM })
  const middle = cands.find((c) => c.id === 'general physics')
  const lowerEM = cands.find((c) => c.id === 'physics: Electromagnetism')
  assert.ok(middle && middle.tier === 'middle' && middle.coveredBy === 'anchor:physics')
  assert.ok(lowerEM && lowerEM.tier === 'lower' && lowerEM.injectsInto === 'general physics')
  // upper has both the KKO categories and the domain anchors
  assert.ok(cands.some((c) => c.tier === 'upper' && c.id === 'kko:Generals'))
  assert.ok(cands.some((c) => c.tier === 'upper' && c.id === 'anchor:physics'))
})

test('ONTOGENESIS: the verified procedural tier is folded into the grounding block', async () => {
  const exp: ReasoningExperience[] = [
    distillExperience({ task: 'compute electric flux with Gauss law', steps: ['identify symmetry', 'apply Gauss law', 'verify units'], outcome: 'C', confidence: 0.82, gateDecision: 'answer', replayClass: 'exact' })!,
  ]
  const jaccard = (a: string, b: string) => {
    const A = new Set(a.toLowerCase().split(/\s+/)), B = new Set(b.toLowerCase().split(/\s+/))
    const i = [...A].filter((x) => B.has(x)).length
    return i / (A.size + B.size - i || 1)
  }
  const r = await tieredGround('compute electric flux through a Gaussian surface', { scorer: physicsEM, experiences: exp, expMatch: jaccard })
  assert.ok(r.experiences.length >= 1)
  assert.match(r.block, /Reasoning from similar verified tasks/)       // procedural tier present
  assert.match(r.block, /general \(connective\): general physics/)     // declarative tier present
})

test('lexicalScore is bounded [0,1] and 0 on no overlap', () => {
  assert.equal(lexicalScore('photosynthesis in plants', 'quantum chromodynamics'), 0)
  const s = lexicalScore('electric flux gauss law', 'electric flux through a surface')
  assert.ok(s > 0 && s <= 1)
})

test('degrades safely: no scorer match anywhere → not grounded, empty block', async () => {
  const r = await tieredGround('xyzzy plugh frobnicate', { scorer: () => 0.1 })
  assert.equal(r.grounding.grounded, false)
  // upper anchor may still be picked (top of a low field), but the block has no tier section when ungrounded w/o anchor floor
  assert.equal(r.experiences.length, 0)
})

/** Tests for the ground MLN Reasoner core (lib/mln.ts) — validated against hand-computed probabilities,
 *  not just "does it run", since this is the load-bearing piece with zero prior implementation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  worldProbability, mapInference, marginalProbability, logWeight,
  isAbstained, detectorEvidence, signedWeight, EPSILON_ZERO,
  discourseGraphToGroundNetwork, edgeAtom, type DiscourseEdge,
  classifySeverity, canUseMapSeverity,
  compileValueDriverTree, driverAtom, type ValueDriverEdge,
  type GroundNetwork,
} from './mln.js'

// ─── core inference math, hand-computed ────────────────────────────────────────────────────────────────

test('single-atom network: P(true) vs P(false) matches exp(w)/(1+exp(w)) exactly', () => {
  // one atom, one formula with weight w=1: worlds are {a:true} logWeight=1, {a:false} logWeight=0.
  // Z = e^1 + e^0. P(true) = e^1/Z, P(false) = e^0/Z. Hand-computed: e≈2.71828, Z≈3.71828.
  const net: GroundNetwork = { atoms: ['a'], formulas: [{ id: 'f1', predicate: 'P', atoms: ['a'], weight: 1, source: 'prior' }] }
  const pTrue = worldProbability(net, { a: true })
  const pFalse = worldProbability(net, { a: false })
  const Z = Math.exp(1) + Math.exp(0)
  assert.ok(Math.abs(pTrue - Math.exp(1) / Z) < 1e-9)
  assert.ok(Math.abs(pFalse - Math.exp(0) / Z) < 1e-9)
  assert.ok(Math.abs(pTrue + pFalse - 1) < 1e-9)   // probabilities sum to 1
})

test('weight=0 (ZERO/abstained) gives a uniform 50/50 split — no probabilistic force', () => {
  const net: GroundNetwork = { atoms: ['a'], formulas: [{ id: 'f1', predicate: 'P', atoms: ['a'], weight: 0, source: 'prior' }] }
  const pTrue = worldProbability(net, { a: true })
  assert.ok(Math.abs(pTrue - 0.5) < 1e-9)
})

test('negative weight makes the atom LESS probable than 50%', () => {
  const net: GroundNetwork = { atoms: ['a'], formulas: [{ id: 'f1', predicate: 'P', atoms: ['a'], weight: -2, source: 'prior' }] }
  assert.ok(worldProbability(net, { a: true }) < 0.5)
  assert.ok(worldProbability(net, { a: false }) > 0.5)
})

test('mapInference picks the higher-logWeight world on a 2-atom network', () => {
  const net: GroundNetwork = {
    atoms: ['a', 'b'],
    formulas: [
      { id: 'f1', predicate: 'P', atoms: ['a'], weight: 2, source: 'prior' },
      { id: 'f2', predicate: 'Q', atoms: ['b'], weight: -1, source: 'prior' },
    ],
  }
  const { world } = mapInference(net)
  assert.equal(world['a'], true)    // strong positive weight -> MAP world has a=true
  assert.equal(world['b'], false)   // negative weight -> MAP world has b=false
})

test('marginalProbability sums over every world where the atom holds, and stays in [0,1]', () => {
  const net: GroundNetwork = {
    atoms: ['a', 'b', 'c'],
    formulas: [
      { id: 'f1', predicate: 'P', atoms: ['a'], weight: 1, source: 'prior' },
      { id: 'f2', predicate: 'Q', atoms: ['b'], weight: -1, source: 'prior' },
      { id: 'f3', predicate: 'R', atoms: ['c'], weight: 0, source: 'prior' },
    ],
  }
  const pa = marginalProbability(net, 'a')
  const pb = marginalProbability(net, 'b')
  const pc = marginalProbability(net, 'c')
  assert.ok(pa > 0.5)    // positive weight
  assert.ok(pb < 0.5)    // negative weight
  assert.ok(Math.abs(pc - 0.5) < 1e-9)   // zero weight -> exactly uniform, independent of a/b
})

test('a network exceeding 22 atoms throws a clear tractability error rather than hanging', () => {
  const atoms = Array.from({ length: 23 }, (_, i) => `a${i}`)
  const net: GroundNetwork = { atoms, formulas: [] }
  assert.throws(() => mapInference(net), /intractable/)
})

// ─── evidence predicates + self-abstention (§2) ────────────────────────────────────────────────────────

test('isAbstained: weight magnitude below EPSILON_ZERO is abstained, above is not', () => {
  assert.ok(isAbstained(0.01))
  assert.ok(isAbstained(-0.01))
  assert.ok(!isAbstained(0.5))
  assert.ok(!isAbstained(EPSILON_ZERO + 0.001))
})

test('detectorEvidence produces a formula that self-abstains at zero weight (no special-case branch needed)', () => {
  const abstained = detectorEvidence('det1', 'IsFallacious(clm1)', 0.001)
  const net: GroundNetwork = { atoms: ['IsFallacious(clm1)'], formulas: [abstained] }
  const p = worldProbability(net, { 'IsFallacious(clm1)': true })
  // sigmoid slope at w=0 is 0.25, so w=0.001 deviates from 0.5 by ~0.00025 — tolerance must accommodate
  // that true math, not an arbitrarily tight bound. 1e-3 still proves "near-uniform, no real force".
  assert.ok(Math.abs(p - 0.5) < 1e-3)
})

test('signedWeight: LOGFALL/COGBIAS detectors are always negative, everything else positive', () => {
  assert.ok(signedWeight('LOGFALL.STRAWMAN.V2', 0.86) < 0)
  assert.ok(signedWeight('COGBIAS.CONFIRM.V1', 0.5) < 0)
  assert.ok(signedWeight('GROUNDED.T1.V1', 0.9) > 0)
  // magnitude is preserved regardless of sign
  assert.equal(Math.abs(signedWeight('LOGFALL.STRAWMAN.V2', 0.86)), 0.86)
})

// ─── discourse graph -> ground network (§3.1) ──────────────────────────────────────────────────────────

test('discourseGraphToGroundNetwork: confidence becomes the formula weight directly', () => {
  const edges: DiscourseEdge[] = [
    { id: 'e1', edgeType: 'attack', src: 'clm1', dst: 'clm2', confidence: 0.71, weightSource: 'induced' },
    { id: 'e2', edgeType: 'support', src: 'clm3', dst: 'clm2', confidence: 0.3, weightSource: 'prior' },
  ]
  const net = discourseGraphToGroundNetwork(edges)
  assert.equal(net.formulas.length, 2)
  assert.equal(net.formulas[0]!.weight, 0.71)
  assert.equal(net.formulas[0]!.predicate, 'Attacks')
  assert.equal(net.formulas[1]!.predicate, 'Supports')
  assert.ok(net.atoms.includes(edgeAtom(edges[0]!)))
})

// ─── severity as MAP threshold (§9) ────────────────────────────────────────────────────────────────────

test('classifySeverity: thresholds partition probability into block/warn/info/pass', () => {
  const t = { block: 0.3, warn: 0.6, ok: 0.85 }
  assert.equal(classifySeverity(0.1, t), 'block')
  assert.equal(classifySeverity(0.3, t), 'warn')     // boundary: block is exclusive-below, so 0.3 is warn
  assert.equal(classifySeverity(0.5, t), 'warn')
  assert.equal(classifySeverity(0.7, t), 'info')
  assert.equal(classifySeverity(0.9, t), 'pass')
})

test('canUseMapSeverity: the small-N gate (Rule SEV-3), matching the N>=30 board discipline', () => {
  assert.equal(canUseMapSeverity(50), 'full')
  assert.equal(canUseMapSeverity(30), 'full')
  assert.equal(canUseMapSeverity(15), 'limited')
  assert.equal(canUseMapSeverity(10), 'fallback')
  assert.equal(canUseMapSeverity(2), 'fallback')
})

// ─── value-driver tree compiler (§8.2) ─────────────────────────────────────────────────────────────────

test('compileValueDriverTree: verb polarity sets weight sign (the subtracted-countertext operator)', () => {
  const edges: ValueDriverEdge[] = [
    { from: 'Goal', to: 'NewCustomers', label: 'Increase new customer acquisition' },
    { from: 'Goal', to: 'Churn', label: 'Reduce customer churn' },
    { from: 'Goal', to: 'Neutral', label: 'Track quarterly' },
  ]
  const net = compileValueDriverTree(edges)
  const byTo = (to: string) => net.formulas.find((f) => f.id.endsWith(`->${to}`))!
  assert.ok(byTo('NewCustomers').weight > 0)
  assert.ok(byTo('Churn').weight < 0)
  assert.ok(byTo('Neutral').weight > 0 && byTo('Neutral').weight < byTo('NewCustomers').weight)   // weak neutral prior, not zero
  assert.ok(net.atoms.includes(driverAtom(edges[0]!)))
})

test('logWeight is the sum of only the FIRING formulas in a given world', () => {
  const net: GroundNetwork = {
    atoms: ['a', 'b'],
    formulas: [
      { id: 'f1', predicate: 'P', atoms: ['a'], weight: 3, source: 'prior' },
      { id: 'f2', predicate: 'Q', atoms: ['b'], weight: 5, source: 'prior' },
    ],
  }
  assert.equal(logWeight(net, { a: true, b: false }), 3)
  assert.equal(logWeight(net, { a: true, b: true }), 8)
  assert.equal(logWeight(net, { a: false, b: false }), 0)
})

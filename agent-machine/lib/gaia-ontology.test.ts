/** Tests for the GAIA ontology mappers — structural state → developmental phase + abandonment signals. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ontogenesisPhase, abandonmentSignals, GAIA_ONTOLOGY, ONTOGENESIS_PHASES, ABANDONMENT_SIGNALS } from './gaia-ontology.js'

test('ontogenesisPhase maps structural state to a valid phase', () => {
  assert.equal(ontogenesisPhase({ degree: 0, pagerank: 0, betweenness: 0, community: -1 }), 'seed', 'disconnected → seed')
  assert.equal(ontogenesisPhase({ degree: 10, pagerank: 0.1, betweenness: 0.6, community: 1 }), 'transmission', 'high betweenness → transmission')
  assert.equal(ontogenesisPhase({ degree: 8, pagerank: 0.7, betweenness: 0.1, community: 1 }), 'maturity', 'load-bearing → maturity')
  assert.equal(ontogenesisPhase({ degree: 1, pagerank: 0.05, betweenness: 0, community: 1 }), 'formation', 'few links → formation')
  assert.equal(ontogenesisPhase({ degree: 5, pagerank: 0.1, betweenness: 0.1, community: 1 }), 'growth', 'mid → growth')
  for (const s of [{ degree: 0, pagerank: 0, betweenness: 0, community: -1 }, { degree: 5, pagerank: 0.1, betweenness: 0.1, community: 1 }])
    assert.ok((ONTOGENESIS_PHASES as readonly string[]).includes(ontogenesisPhase(s)))
})

test('abandonmentSignals fires orphaned_artifact for disconnected nodes', () => {
  const sigs = abandonmentSignals({ degree: 0, pagerank: 0, community: -1 })
  assert.ok(sigs.includes('orphaned_artifact'), 'degree 0 / no community → orphaned_artifact')
})

test('abandonmentSignals fires critical_dependency_failed for important-but-isolated', () => {
  const sigs = abandonmentSignals({ degree: 1, pagerank: 0.5, community: 2 })
  assert.ok(sigs.includes('critical_dependency_failed'), 'high pagerank + low degree → critical dependency')
})

test('abandonmentSignals fires stale_evidence only when grounding is false', () => {
  assert.ok(abandonmentSignals({ degree: 5, pagerank: 0.1, community: 1, grounded: false }).includes('stale_evidence'))
  assert.ok(!abandonmentSignals({ degree: 5, pagerank: 0.1, community: 1, grounded: true }).includes('stale_evidence'))
})

test('a healthy node has no abandonment signals', () => {
  assert.equal(abandonmentSignals({ degree: 6, pagerank: 0.1, community: 1 }).length, 0)
})

test('every emitted signal is a member of the contract enum', () => {
  const all = [
    ...abandonmentSignals({ degree: 0, pagerank: 0, community: -1 }),
    ...abandonmentSignals({ degree: 1, pagerank: 0.5, community: 2 }),
    ...abandonmentSignals({ degree: 5, pagerank: 0.1, community: 1, grounded: false }),
  ]
  for (const s of all) assert.ok((ABANDONMENT_SIGNALS as readonly string[]).includes(s))
})

test('ontology bundle exposes the full contract', () => {
  assert.equal(GAIA_ONTOLOGY.nodeKinds.length, 12)
  assert.equal(GAIA_ONTOLOGY.edgeKinds.length, 25)
  assert.ok(GAIA_ONTOLOGY.invariants.length >= 5)
})

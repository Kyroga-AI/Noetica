/** Graph-RL policy — LinUCB contextual bandit: featurization shape + genuine contextual convergence. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LinUCBPolicy } from './grl-policy.js'
import { featurizeGraphState, GRAPH_STATE_DIM, type GraphState } from './graph-state.js'

test('featurizeGraphState returns a fixed-dim normalized vector with epistemic fractions', () => {
  const gs: GraphState = {
    epistemic: { verified: 3, observed: 1 }, subgraphSize: 4, edgeCount: 4,
    topNodeShare: 0.5, grounded: true, queryTokens: 8,
  }
  const x = featurizeGraphState(gs)
  assert.equal(x.length, GRAPH_STATE_DIM)
  assert.equal(x[0], 1)                    // bias
  assert.ok(Math.abs(x[1]! - 0.75) < 1e-9) // high-trust fraction = 3/4
  assert.ok(Math.abs(x[2]! - 0.25) < 1e-9) // observed = 1/4
  assert.equal(x[8], 1)                    // grounded flag
  for (const v of x) assert.ok(v >= 0 && v <= 1, 'every component in [0,1]')
})

test('select returns a declared action and scores every arm', () => {
  const p = new LinUCBPolicy(['fiber', 'graph-rag', 'vector'], GRAPH_STATE_DIM)
  const x = featurizeGraphState({ epistemic: { observed: 2 }, subgraphSize: 2, edgeCount: 1, topNodeShare: 0.3, grounded: false, queryTokens: 5 })
  const { action, scores } = p.select(x)
  assert.ok(['fiber', 'graph-rag', 'vector'].includes(action))
  assert.equal(Object.keys(scores).length, 3)
})

// seeded LCG so convergence is deterministic
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (1103515245 * s + 12345) >>> 0) / 0xffffffff }

test('LinUCB LEARNS the context→action mapping (contextual convergence, not a paper tiger)', () => {
  // True environment: when the subgraph is high-trust + dense, "graph-rag" is best; when it is
  // sparse + hypothesised, "vector" recall is best. The policy must discover this from reward alone.
  const p = new LinUCBPolicy(['graph-rag', 'vector'], GRAPH_STATE_DIM, 0.6)
  const rnd = lcg(42)
  const denseVerified: GraphState = { epistemic: { verified: 8, observed: 2 }, subgraphSize: 10, edgeCount: 18, topNodeShare: 0.2, grounded: true, queryTokens: 12 }
  const sparseHypo: GraphState = { epistemic: { hypothesis: 2, unknown: 1 }, subgraphSize: 3, edgeCount: 1, topNodeShare: 0.8, grounded: false, queryTokens: 4 }

  for (let i = 0; i < 400; i++) {
    const dense = rnd() < 0.5
    const gs = dense ? denseVerified : sparseHypo
    const x = featurizeGraphState(gs)
    const { action } = p.select(x)
    // reward from the true model + small noise; the correct arm pays ~0.9, the wrong ~0.15
    const best = dense ? 'graph-rag' : 'vector'
    const base = action === best ? 0.9 : 0.15
    const reward = Math.max(0, Math.min(1, base + (rnd() - 0.5) * 0.2))
    p.update(action, x, reward)
  }

  // After learning, greedy choice must match the environment in BOTH contexts
  assert.equal(p.select(featurizeGraphState(denseVerified)).action, 'graph-rag')
  assert.equal(p.select(featurizeGraphState(sparseHypo)).action, 'vector')
})

test('serialize/hydrate round-trips the learned weights', () => {
  const p = new LinUCBPolicy(['a', 'b'], GRAPH_STATE_DIM)
  const x = featurizeGraphState({ epistemic: { verified: 5 }, subgraphSize: 5, edgeCount: 6, topNodeShare: 0.4, grounded: true, queryTokens: 10 })
  for (let i = 0; i < 20; i++) p.update('a', x, 0.9)
  const dump = p.serialize()
  const q = new LinUCBPolicy(['a', 'b'], GRAPH_STATE_DIM)
  assert.equal(q.hydrate(dump), 2)
  // same context → same scores after hydrate
  assert.deepEqual(q.select(x).scores, p.select(x).scores)
})

test('hydrate rejects a dimension mismatch (never corrupts the policy)', () => {
  const p = new LinUCBPolicy(['a'], GRAPH_STATE_DIM)
  assert.equal(p.hydrate(JSON.stringify({ dim: 3, arms: [{ action: 'a', Ainv: [[1]], b: [0], plays: 1, rewardSum: 1 }] })), 0)
})

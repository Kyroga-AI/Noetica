/** Graph-RL loop — reward mining + the closed decide→observe→persist loop over a temp store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { grlReward } from './grl-reward.js'
import { GrlLoop, RETRIEVAL_ACTIONS } from './grl-loop.js'
import type { GraphState } from './graph-state.js'

test('grlReward: explicit human signal dominates; automatic signals blend; no signal → null', () => {
  assert.equal(grlReward({ accepted: true, grounding: 'ungrounded' }), 1)   // accept overrides
  assert.equal(grlReward({ rejected: true, worth: 0.9 }), 0)                 // reject overrides
  assert.equal(grlReward({ thumbs: 'up' }), 1)
  assert.equal(grlReward({ grounding: 'ok', assay: 'ok' }), 1)              // (1+1)/2
  assert.equal(grlReward({ grounding: 'ungrounded', assay: 'bad' }), 0)
  assert.equal(grlReward({ grounding: 'partial', assay: 'sad' }), 0.5)      // (0.5+0.5)/2
  assert.equal(grlReward({}), null)                                         // nothing to learn from
})

function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'grl-')) }
const gs = (over: Partial<GraphState> = {}): GraphState =>
  ({ epistemic: { verified: 4, observed: 1 }, subgraphSize: 5, edgeCount: 6, topNodeShare: 0.3, grounded: true, queryTokens: 8, ...over })

test('closed loop: decide → observe emits proof-carrying events, logs a transition, updates the policy', () => {
  const dir = tmpDir()
  const events: { type: string; payload: Record<string, unknown> }[] = []
  const loop = new GrlLoop({ storeDir: dir, emit: (e) => events.push(e), saveEvery: 1 })

  const d = loop.decide(gs())
  assert.ok((RETRIEVAL_ACTIONS as readonly string[]).includes(d.action))
  assert.equal(Object.keys(d.scores).length, RETRIEVAL_ACTIONS.length)
  assert.ok(events.some((e) => e.type === 'noetica.grl.decide'))

  const reward = loop.observe({ turnId: 't1', action: d.action, context: d.context, signals: { grounding: 'ok', assay: 'ok' } })
  assert.equal(reward, 1)
  assert.ok(events.some((e) => e.type === 'noetica.grl.reward'))

  // a numeric transition was appended (the replay buffer — the offline-RL training set)
  const tx = fs.readFileSync(path.join(dir, 'grl-transitions.jsonl'), 'utf8').trim().split('\n')
  assert.equal(tx.length, 1)
  const row = JSON.parse(tx[0]!)
  assert.equal(row.action, d.action)
  assert.equal(row.reward, 1)
  assert.ok(Array.isArray(row.context))
  // standings reflect the play
  assert.equal(loop.standings().reduce((s, a) => s + a.plays, 0), 1)
})

test('observe with no signal does not update or log', () => {
  const dir = tmpDir()
  const loop = new GrlLoop({ storeDir: dir })
  const d = loop.decide(gs())
  assert.equal(loop.observe({ action: d.action, context: d.context, signals: {} }), null)
  assert.equal(fs.existsSync(path.join(dir, 'grl-transitions.jsonl')), false)
})

test('learned weights persist + reload across loop instances', () => {
  const dir = tmpDir()
  const a = new GrlLoop({ storeDir: dir, saveEvery: 1 })
  const ctxState = gs({ epistemic: { hypothesis: 3 }, grounded: false, subgraphSize: 3 })
  for (let i = 0; i < 15; i++) { const d = a.decide(ctxState); a.observe({ action: 'vector-rag', context: d.context, signals: { thumbs: 'up' } }) }
  a.save()
  const b = new GrlLoop({ storeDir: dir })   // fresh instance hydrates from disk
  assert.ok(b.standings().some((s) => s.action === 'vector-rag' && s.plays > 0), 'plays survived reload')
})

test('multi-policy spine: a second named policy learns independently over the shared graph state', () => {
  const dir = tmpDir()
  const loop = new GrlLoop({ storeDir: dir, saveEvery: 1 })
  const OPS = ['compute', 'lookup', 'evaluate'] as const
  // teach the operation-route policy that "compute" pays off in this state
  for (let i = 0; i < 20; i++) {
    const d = loop.decideFor('operation-route', OPS, gs())
    loop.observeFor('operation-route', OPS, { action: 'compute', context: d.context, signals: { thumbs: 'up' } })
  }
  const st = loop.standingsFor('operation-route')
  assert.ok(st.some((s) => s.action === 'compute' && s.plays === 20))
  // the retrieval policy is untouched (independent arms)
  assert.equal(loop.standings().reduce((s, a) => s + a.plays, 0), 0)
  // its weights persisted under a per-policy file
  loop.save()
  assert.ok(fs.existsSync(path.join(dir, 'grl-operation-route-policy.json')))
})

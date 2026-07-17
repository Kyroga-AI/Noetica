/** grl-federation — coarse bucketing, opt-in gating, publish/pull, and warm-start blend. */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { bucketOf, contextFromBucket, meshEnabled, publishTransitions, pullPrior } from './grl-federation.js'
import { featurizeGraphState, type GraphState } from './graph-state.js'
import { GrlLoop } from './grl-loop.js'

const ENV = ['GRL_MESH_URL', 'GRL_MESH_TOKEN', 'GRL_MESH_SOVEREIGN_ID']
afterEach(() => { for (const k of ENV) delete process.env[k] })
function enableMesh() { process.env.GRL_MESH_URL = 'http://mesh:8080'; process.env.GRL_MESH_TOKEN = 'tok'; process.env.GRL_MESH_SOVEREIGN_ID = 'node-A' }

const gs = (o: Partial<GraphState> = {}): GraphState =>
  ({ epistemic: { verified: 8, observed: 2 }, subgraphSize: 10, edgeCount: 18, topNodeShare: 0.2, grounded: true, queryTokens: 12, ...o })

test('bucketOf is coarse + non-identifying (trust × size × grounded)', () => {
  const hi = bucketOf(featurizeGraphState(gs()))
  assert.match(hi, /t:hi/)
  assert.match(hi, /g:1/)
  const lo = bucketOf(featurizeGraphState(gs({ epistemic: { hypothesis: 2 }, subgraphSize: 2, grounded: false })))
  assert.match(lo, /t:lo/)
  assert.match(lo, /g:0/)
})

test('contextFromBucket ∘ bucketOf preserves the coarse cell', () => {
  const b = bucketOf(featurizeGraphState(gs()))
  assert.equal(bucketOf(contextFromBucket(b)), b)
})

test('opt-in: no env → mesh disabled, publish is a no-op (never calls fetch)', () => {
  assert.equal(meshEnabled(), false)
  let called = 0
  publishTransitions([{ action: 'kb', context: featurizeGraphState(gs()), reward: 1 }], 'retrieval-mode', (async () => { called++; return new Response('{}') }) as unknown as typeof fetch)
  assert.equal(called, 0)
})

test('configured: publish posts redacted observations with the sovereign envelope', async () => {
  enableMesh()
  let body: any, headers: any
  const fakeFetch = (async (_url: string, init: RequestInit) => { body = JSON.parse(init.body as string); headers = init.headers; return new Response('{"ok":true}') }) as unknown as typeof fetch
  publishTransitions([{ action: 'kb', context: featurizeGraphState(gs()), reward: 0.9 }], 'retrieval-mode', fakeFetch)
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(body.policy, 'retrieval-mode')
  assert.equal(body.observations[0].action, 'kb')
  assert.match(body.observations[0].context_bucket, /t:hi/)   // coarse bucket, not the raw vector
  assert.equal(body.observations[0].reward, 0.9)
  assert.equal((headers as Record<string, string>)['x-sovereign-id'], 'node-A')
})

test('pullPrior returns [] when unconfigured (fail-open)', async () => {
  assert.deepEqual(await pullPrior('retrieval-mode'), [])
})

test('pullPrior parses the community prior', async () => {
  enableMesh()
  const fake = (async () => new Response(JSON.stringify({ priors: [{ action: 'kb', context_bucket: 't:hi|s:lg|g:1', mean_reward: 0.85, n: 12 }] }))) as unknown as typeof fetch
  const priors = await pullPrior('retrieval-mode', fake)
  assert.equal(priors.length, 1)
  assert.equal(priors[0]!.action, 'kb')
})

test('seedFromPrior warm-starts the local policy from the community prior', () => {
  const loop = new GrlLoop({ storeDir: `${process.env.TMPDIR ?? '/tmp'}/grlfed-${process.pid}` })
  const applied = loop.seedFromPrior([{ action: 'kb', context_bucket: 't:hi|s:lg|g:1', mean_reward: 0.9, n: 20 }])
  assert.equal(applied, 5)  // bounded to maxPseudo
  assert.ok(loop.standings().some((s) => s.action === 'kb' && s.plays === 5))
})

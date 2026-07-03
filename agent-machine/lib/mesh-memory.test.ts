import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MeshMemoryClient, scopeEnvelopeFor, meshMemoryStore, type Fetchish } from './mesh-memory.js'
import { autoDream, extractMemory, type TopicDoc } from './memory-layers.js'

// a fake memoryd: records writes, answers recalls from what was written
function fakeMesh() {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = []
  const store: Array<{ content: string; memoryClass: string; metadata?: Record<string, unknown>; tags?: string[] }> = []
  const fetchImpl: Fetchish = async (url, init) => {
    const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
    if (url.endsWith('/v1/write')) {
      store.push({ content: body.content as string, memoryClass: body.memoryClass as string, metadata: body.metadata as Record<string, unknown>, tags: body.tags as string[] })
      writes.push({ url, body })
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ event_id: `e${store.length}`, stored_locally: true }) }
    }
    if (url.endsWith('/v1/recall')) {
      const filters = (body.filters ?? {}) as Record<string, unknown>
      const q = String(body.query ?? '')
      const hits = store
        .filter((s) => (filters.memoryClass ? s.memoryClass === filters.memoryClass : true))
        .filter((s) => (filters.name ? s.metadata?.name === filters.name : true))
        .filter((s) => (q === '*' ? true : s.content.includes(q) || s.metadata?.name === q))
        .map((s, i) => ({ memory_id: `m${i}`, text: s.content, score: 1, source: 'mesh', scope: 'user_local', tags: s.tags, metadata: s.metadata }))
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ query: q, hits, compiled_policy: null }) }
    }
    return { ok: false, status: 404, statusText: 'nope', json: async () => ({}) }
  }
  return { fetchImpl, writes, store }
}

const env = scopeEnvelopeFor('self', { user_id: 'michael', agent_id: 'noetica', run_id: 'r1' })
const doc = (name: string, body: string, extra: Partial<TopicDoc> = {}): TopicDoc => ({ name, body, links: [], updatedAt: 0, ...extra })

test('scopeEnvelopeFor maps trust namespace → memory-mesh scope', () => {
  assert.equal(scopeEnvelopeFor('self', { user_id: 'u', agent_id: 'a', run_id: 'r' }).metadata?.scope, 'user_local')
  assert.equal(scopeEnvelopeFor('collective', { user_id: 'u', agent_id: 'a', run_id: 'r' }).metadata?.scope, 'global_platform')
})

test('meshMemoryStore writes a topic to /v1/write with the ScopeEnvelope', async () => {
  const { fetchImpl, writes } = fakeMesh()
  const store = meshMemoryStore(new MeshMemoryClient('http://mesh', '', fetchImpl), env)
  await store.writeTopic(doc('deploy', 'continuum make dev-up', { links: ['porter'], score: 3 }))
  assert.equal(writes.length, 1)
  assert.equal(writes[0].body.memoryClass, 'topic')
  assert.equal((writes[0].body.envelope as { user_id: string }).user_id, 'michael')
  assert.deepEqual(writes[0].body.tags, ['porter'])
})

test('meshMemoryStore reads a topic back + greps transcripts via recall', async () => {
  const { fetchImpl } = fakeMesh()
  const store = meshMemoryStore(new MeshMemoryClient('http://mesh', '', fetchImpl), env)
  await store.writeTopic(doc('tritrpc', 'envelope header/sender/error', { score: 2 }))
  await store.appendTranscript('graph ops note')
  const back = await store.readTopic('tritrpc')
  assert.equal(back?.body, 'envelope header/sender/error')
  assert.equal(back?.score, 2)
  assert.deepEqual(await store.grepTranscripts('graph ops'), ['graph ops note'])
})

test('the layered memory runs its 5-phase autoDream on a mesh-backed store', async () => {
  const { fetchImpl } = fakeMesh()
  const store = meshMemoryStore(new MeshMemoryClient('http://mesh', '', fetchImpl), env)
  await extractMemory(store, doc('keep', 'salient', { score: 5 }))
  const rep = await autoDream(store)
  assert.ok(rep.indexed >= 1)   // index-sync ran against the mesh-backed topics
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AgentMemory } from './agent-memory.js'
import { MeshMemoryClient, type Fetchish } from './mesh-memory.js'

let dir: string
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noetica-am-')); process.env.NOETICA_MEMORY_DIR = dir })
after(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const identity = { user_id: 'michael', agent_id: 'noetica', run_id: 'r1' }

test('a secret ingest lands on-device (self namespace, fs backend) + is recallable', async () => {
  const am = new AgentMemory({ identity })
  const r = await am.ingest({ name: 'creds-note', content: 'the deploy secret rotates weekly', labels: ['secret'] })
  assert.equal(r.admitted, true)
  assert.equal(r.namespace, 'self')
  assert.equal(r.backend, 'fs')
  assert.equal(r.membrane.scope, 'user_local')
  assert.ok((await am.recall('self', 'deploy secret')).length >= 1)
})

test('leakage prevention: a secret under a public label is DENIED (not admitted)', async () => {
  const am = new AgentMemory({ identity })
  const r = await am.ingest({ name: 'leak', content: 'token ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789', labels: ['public'] })
  assert.equal(r.admitted, false)
  assert.equal(r.membrane.decision, 'DENY')
  assert.equal(r.chunks, 0)
})

test('public data in the collective namespace rides memory-mesh', async () => {
  const writes: Array<Record<string, unknown>> = []
  const fetchImpl: Fetchish = async (url, init) => {
    const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
    if (url.endsWith('/v1/write')) { writes.push(body); return { ok: true, status: 200, statusText: 'OK', json: async () => ({ event_id: 'e1' }) } }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ query: '', hits: [], compiled_policy: null }) }
  }
  const am = new AgentMemory({ identity, mesh: new MeshMemoryClient('http://mesh', '', fetchImpl) })
  const r = await am.ingest({ name: 'press', content: 'public launch announcement', labels: ['public'], namespace: 'collective' })
  assert.equal(r.admitted, true)
  assert.equal(r.namespace, 'collective')
  assert.equal(r.backend, 'mesh')
  assert.equal(r.membrane.scope, 'global_platform')
  assert.ok(writes.length >= 1)
  assert.equal((writes[0].envelope as { metadata: { scope: string } }).metadata.scope, 'global_platform')
})

test('ingest situates content (contextual-retrieval preamble is present)', async () => {
  const am = new AgentMemory({ identity })
  await am.ingest({ name: 'doc', title: 'Runbook', content: '## Deploy\nrun make dev-up over kind', labels: ['internal'] })
  const hits = await am.recall('workspace', 'Runbook')
  assert.ok(hits.some((h) => /Document: Runbook/.test(h)))
})

test('consolidate runs the 5-phase autoDream on the scoped store', async () => {
  const am = new AgentMemory({ identity })
  await am.ingest({ name: 'a', content: 'salient note', labels: ['internal'] })
  const rep = await am.consolidate('workspace')
  assert.ok(rep.indexed >= 1)
})

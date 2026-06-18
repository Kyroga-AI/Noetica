/**
 * Black-box HTTP integration test for the agent-machine.
 *
 * Boots the real server in a child process (NODE_ENV=test → in-memory store,
 * isolated) on a test port and exercises the live HTTP surface end-to-end —
 * WITHOUT needing Ollama or any model. This catches wiring regressions across the
 * subsystems added over this project (goals, checkpoints, quality-SR, self-model,
 * contradiction ledger, graph health, benchmark) that pure unit tests can't.
 *
 * Run: npm run test:integration   (from agent-machine/)
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'

const PORT = 8099
const BASE = `http://127.0.0.1:${PORT}`
let server: ChildProcess

async function get(path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
async function post(path: string, payload: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

before(async () => {
  server = spawn('node', ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: 'test', NOETICA_AM_PORT: String(PORT) },
    stdio: 'ignore',
  })
  // Poll until the server is listening.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error('server did not start within 30s')
})

after(() => { server?.kill('SIGKILL') })

test('GET /api/status returns version + capabilities', async () => {
  const { status, body } = await get('/api/status')
  assert.equal(status, 200)
  assert.ok(body.version, 'version present')
})

test('goals CRUD round-trips', async () => {
  const create = await post('/api/goals', { session_id: 'itest', objective: 'ship integration tests', subtasks: [{ title: 'write', done: false }], slots: [{ name: 'scope', filled: false }] })
  assert.equal(create.status, 200)
  assert.equal(create.body.goal.objective, 'ship integration tests')
  const list = await get('/api/goals?session=itest')
  assert.ok(list.body.goals.some((g: any) => g.objective === 'ship integration tests'))
})

test('self-model + feedback endpoints respond', async () => {
  assert.equal((await get('/api/self/capabilities')).status, 200)
  const fb = await post('/api/self/feedback', { task: 'general', provider: 'ollama', model: 'qwen2.5:7b', reward: 0.9 })
  assert.equal(fb.status, 200)
  assert.equal(fb.body.ok, true)
})

test('quality drivers, checkpoints, contradictions, benchmark, graph health all respond', async () => {
  const q = await get('/api/quality/drivers'); assert.equal(q.status, 200); assert.ok('total_samples' in q.body)
  const c = await get('/api/checkpoints?session=itest'); assert.equal(c.status, 200); assert.ok(Array.isArray(c.body.checkpoints))
  const e = await get('/api/epistemic/contradictions'); assert.equal(e.status, 200); assert.ok(Array.isArray(e.body.contradictions))
  const b = await get('/api/benchmark/summary'); assert.equal(b.status, 200); assert.ok(Array.isArray(b.body.summary))
  const h = await get('/api/graph/health'); assert.equal(h.status, 200); assert.ok(h.body.graph)
})

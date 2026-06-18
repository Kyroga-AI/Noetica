/**
 * RocksDB persistence + auth integration test for the agent-machine.
 *
 * Boots the server with HELLGRAPH_BACKEND=rocksdb against a temp store, writes a
 * goal, shuts down, reboots a fresh process over the SAME store, and asserts the
 * goal survived — i.e. the convergence backend actually persists end-to-end through
 * the real HTTP surface (not just the engine unit test). Also verifies the optional
 * API-token gate returns 401 when NOETICA_API_TOKEN is set.
 *
 * Skips gracefully if the rocksdb binding isn't available. Run: npm run test:integration:rocks
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const PORT = 8097
const BASE = `http://127.0.0.1:${PORT}`
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-rocks-it-'))
const cwd = new URL('..', import.meta.url).pathname

async function rocksAvailable(): Promise<boolean> {
  try { await import('rocksdb'); return true } catch { return false }
}

function boot(extraEnv: Record<string, string>): ChildProcess {
  return spawn('node', ['--import', 'tsx', 'server.ts'], {
    cwd,
    env: { ...process.env, NOETICA_AM_PORT: String(PORT), HELLGRAPH_BACKEND: 'rocksdb', HELLGRAPH_STORE_DIR: STORE, ...extraEnv },
    stdio: 'ignore',
  })
}
async function waitUp(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return } catch { /* wait */ }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error('server did not start')
}
const kill = (p: ChildProcess) => new Promise<void>((res) => { p.once('exit', () => res()); p.kill('SIGKILL') })

after(() => { try { fs.rmSync(STORE, { recursive: true, force: true }) } catch { /* ignore */ } })

test('RocksDB backend persists a goal across a full server restart', async (t) => {
  if (!(await rocksAvailable())) { t.skip('rocksdb binding unavailable'); return }

  const s1 = boot({})
  await waitUp()
  const create = await fetch(`${BASE}/api/goals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'rocks-it', objective: 'survive a reboot', subtasks: [], slots: [] }),
  })
  assert.equal(create.status, 200)
  // give the async RocksDB write chain a moment to flush
  await new Promise((r) => setTimeout(r, 500))
  await kill(s1)

  // confirm the store materialised on disk
  assert.ok(fs.existsSync(path.join(STORE, 'sociosphere-primary.rocks')), '.rocks dir created')

  const s2 = boot({})
  await waitUp()
  const list = await (await fetch(`${BASE}/api/goals?session=rocks-it`)).json()
  await kill(s2)
  assert.ok(list.goals.some((g: any) => g.objective === 'survive a reboot'), 'goal restored from RocksDB after restart')
})

test('NOETICA_API_TOKEN gates destructive endpoints (401 without token, 200 with)', async () => {
  const s = boot({ NOETICA_API_TOKEN: 'secret-test-token' })
  await waitUp()
  try {
    const noAuth = await fetch(`${BASE}/api/self/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(noAuth.status, 401, 'rejected without token')
    const withAuth = await fetch(`${BASE}/api/self/reset`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret-test-token' }, body: '{}',
    })
    assert.equal(withAuth.status, 200, 'accepted with token')
  } finally { await kill(s) }
})

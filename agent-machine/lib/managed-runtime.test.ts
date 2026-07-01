import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { shouldManageRuntime, selectOrphanRunners, type RunnerProc } from './managed-runtime.js'
import { runtimeComplete } from './managed-ollama.js'

test('shouldManageRuntime: macOS default ON when targeting the isolated port', () => {
  assert.equal(shouldManageRuntime({}, 'darwin'), true)
  assert.equal(shouldManageRuntime({ OLLAMA_HOST: 'http://127.0.0.1:11435' }, 'darwin'), true)
})

test('shouldManageRuntime: skipped on dev override or when disabled or off-mac', () => {
  assert.equal(shouldManageRuntime({ OLLAMA_HOST: 'http://127.0.0.1:11434' }, 'darwin'), false) // dev:backend
  assert.equal(shouldManageRuntime({ NOETICA_MANAGED_RUNTIME: '0' }, 'darwin'), false)
  assert.equal(shouldManageRuntime({}, 'linux'), false) // Linux uses the container provider
})

test('selectOrphanRunners: reaps emptied, aged surplus but keeps the loaded model resident', () => {
  const runners: RunnerProc[] = [
    { pid: 100, rssKb: 1_400_000, ageSec: 300 }, // live model (1.4GB resident) — never reap
    { pid: 101, rssKb: 7_000,     ageSec: 300 }, // orphan: empty + old
    { pid: 102, rssKb: 8_000,     ageSec: 280 }, // orphan: empty + old
    { pid: 103, rssKb: 5_000,     ageSec: 30 },  // just spawned (< settle) — mid cold-load, don't kill
  ]
  const reap = selectOrphanRunners(runners, 1) // ollama reports 1 model loaded
  assert.deepEqual(reap.sort((a, b) => a - b), [101, 102])
})

test('selectOrphanRunners: never reaps below the loaded-model count (paged-out guard)', () => {
  const runners: RunnerProc[] = [
    { pid: 1, rssKb: 9_000, ageSec: 400 },
    { pid: 2, rssKb: 9_000, ageSec: 400 },
  ]
  assert.deepEqual(selectOrphanRunners(runners, 2), [], 'surplus is zero → reap nothing')
  assert.deepEqual(selectOrphanRunners(runners, 1).length, 1, 'reap only the one surplus')
})

test('selectOrphanRunners: empty input and no orphans are no-ops', () => {
  assert.deepEqual(selectOrphanRunners([], 0), [])
  assert.deepEqual(selectOrphanRunners([{ pid: 5, rssKb: 2_000_000, ageSec: 999 }], 0), [], 'a resident model is not an orphan')
})

test('runtimeComplete: detects the runner flat (macOS) or under lib/ollama (Linux)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'))
  const bin = path.join(dir, 'ollama')
  fs.writeFileSync(bin, '')
  assert.equal(runtimeComplete(bin), false, 'binary alone is NOT complete (the original freeze)')
  fs.writeFileSync(path.join(dir, 'llama-server'), '') // flat macOS layout
  assert.equal(runtimeComplete(bin), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

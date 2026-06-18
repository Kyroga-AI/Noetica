import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { shouldManageRuntime } from './managed-runtime.js'
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

test('runtimeComplete: detects the runner flat (macOS) or under lib/ollama (Linux)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'))
  const bin = path.join(dir, 'ollama')
  fs.writeFileSync(bin, '')
  assert.equal(runtimeComplete(bin), false, 'binary alone is NOT complete (the original freeze)')
  fs.writeFileSync(path.join(dir, 'llama-server'), '') // flat macOS layout
  assert.equal(runtimeComplete(bin), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

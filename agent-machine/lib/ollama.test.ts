import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRunnerMissing, setOllamaBase, ollamaBase, isOllamaRunning } from './ollama.js'

test('isRunnerMissing detects the bundled-Ollama missing-llama-server failure', () => {
  // The exact 500 body Ollama emits when the inference runner is absent.
  assert.equal(isRunnerMissing(500, 'error starting llama-server: llama-server binary not found (checked: …)'), true)
  assert.equal(isRunnerMissing(500, 'no runner found for model'), true)
})

test('isRunnerMissing does NOT trip on ordinary errors', () => {
  assert.equal(isRunnerMissing(404, 'model not found'), false)      // wrong status
  assert.equal(isRunnerMissing(400, 'invalid request'), false)
  assert.equal(isRunnerMissing(500, 'context length exceeded'), false) // 500 but unrelated
})

test('pinned managed base is authoritative — health probe must NOT revert to the primary', async () => {
  // The .app bug: managed runtime pinned :11436 but isOllamaRunning() wandered back
  // to the bundled (broken) Ollama on the primary port. Pinning must hold even when
  // the pinned base is momentarily unreachable.
  setOllamaBase('http://127.0.0.1:9') // pin to a dead port
  await isOllamaRunning()              // probes only the pinned base (fails), must NOT reselect primary
  assert.equal(ollamaBase(), 'http://127.0.0.1:9', 'pinned base held; did not revert to OLLAMA_PRIMARY')
})

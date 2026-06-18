import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRunnerMissing } from './ollama.js'

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
